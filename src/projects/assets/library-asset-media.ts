import "server-only";

import { NextResponse } from "next/server";
import {
  findImageableAssetInDraft,
  readProjectAssetImageFile,
  isSafeProjectAssetImageId,
  type ProjectAssetImageMime,
} from "@/projects/assets/asset-image-storage";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  loadAssetBundleForScope,
  saveAssetBundleForScope,
  type AssetBundleStoreScope,
} from "@/projects/assets/asset-bundle-scope";
import {
  parseGenerateAssetRequest,
  type ParsedGenerateAssetReferenceImage,
} from "@/projects/assets/episode-design/parse-generate-asset-request";
import {
  resolvePersonalMaterialReference,
  resolveSystemMaterialReference,
} from "@/materials/resolve-look-reference-sources";
import { isDesignImageModelId } from "@/projects/assets/episode-design/image-generation-models";
import { mergeMediaIdLists } from "@/projects/assets/episode-design/generated-media-history";
import {
  addCharacterLook,
  setCharacterPrimary,
  resolveCharacterPrimaryMediaId,
} from "@/projects/assets/character-media-state";
import { isAppearanceMedia } from "@/projects/assets/character-appearance-state";
import {
  releaseGenerationCredits,
  reserveImageGenerationCredits,
} from "@/credits/generation-billing";
import { buildSceneCharacterPlacementPrompt } from "@/projects/storyboard/scene-character-placements";
import type { SceneCharacterPlacement } from "@/projects/storyboard/types";
import type { CharacterAsset } from "@/projects/assets/types";
import { createAndEnqueueImageJob } from "@/projects/assets/image-generation/process-job";
import { publicImageJobView } from "@/projects/assets/image-generation/public-view";

export type LibraryAssetKind = "character" | "prop" | "scene";

export type AssetImageGenerationResponse = {
  mediaId: string;
  mediaIds: string[];
  images: Array<{ mediaId: string; mimeType: string }>;
  mode: "text_to_image" | "image_to_image";
  generatedAt: string;
  notice?: string;
};

export type SaveAssetMediaResponse = {
  assetId: string;
  assetKind: LibraryAssetKind;
  mediaId: string;
  approvedMediaIds: string[];
  primaryMediaId: string | null;
};

function isLibraryAssetKind(value: unknown): value is LibraryAssetKind {
  return value === "character" || value === "prop" || value === "scene";
}

function readFormString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function assetAllowedMediaIds(asset: {
  approvedMediaIds?: string[];
  primaryMediaId?: string | null;
  imageFileName?: string | null;
}): Set<string> {
  return new Set(
    [
      ...(asset.approvedMediaIds ?? []),
      asset.primaryMediaId,
      asset.imageFileName,
    ].filter((id): id is string => typeof id === "string" && Boolean(id.trim())),
  );
}

function parsePlacementsField(raw: string): SceneCharacterPlacement[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SceneCharacterPlacement => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return (
        typeof row.characterAssetId === "string" &&
        typeof row.x === "number" &&
        typeof row.y === "number"
      );
    });
  } catch {
    return [];
  }
}

/**
 * Formal library asset media generation (text-to-image for library prompt panel;
 * image-to-image for look / secondary editors).
 * Reuses parseGenerateAssetRequest + generateDesignAssetImage + billing.
 */
export async function runLibraryAssetMediaGenerate(input: {
  request: Request;
  projectId: string;
  actorUserId: string;
  store?: AssetBundleStoreScope;
}): Promise<NextResponse> {
  const scope = input.store ?? "management";
  const contentType = (input.request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "须使用 multipart/form-data", code: "MULTIPART_REQUIRED" },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await input.request.formData();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const assetId = readFormString(form, "assetId");
  const assetKindRaw = readFormString(form, "assetKind");
  if (!assetId || !isSafeProjectAssetImageId(assetId)) {
    return NextResponse.json({ error: "缺少有效资产 ID" }, { status: 400 });
  }
  if (!isLibraryAssetKind(assetKindRaw)) {
    return NextResponse.json(
      { error: "assetKind 只能是 character、prop 或 scene", code: "INVALID_ASSET_KIND" },
      { status: 400 },
    );
  }

  const modeRaw = readFormString(form, "mode") || "image_to_image";
  if (modeRaw !== "image_to_image" && modeRaw !== "text_to_image") {
    return NextResponse.json(
      {
        error: "正式资产媒体生成仅支持文生图或图生图",
        code: "INVALID_GENERATE_MODE",
      },
      { status: 400 },
    );
  }

  // Rebuild a Request so parseGenerateAssetRequest can consume FormData again.
  const passthrough = new FormData();
  for (const [key, value] of form.entries()) {
    passthrough.append(key, value);
  }
  if (!passthrough.has("mode")) passthrough.set("mode", modeRaw);
  // Allow placement-only prompts: parseGenerateAssetRequest requires a prompt string.
  const placementsPreview = parsePlacementsField(
    readFormString(form, "sceneCharacterPlacements"),
  );
  if (
    !readFormString(form, "prompt") &&
    assetKindRaw === "scene" &&
    placementsPreview.length > 0
  ) {
    passthrough.set("prompt", "按角色位置约束进行图生图编辑。");
  }
  const parsed = await parseGenerateAssetRequest(
    new Request("http://localhost/library-asset-media-generate", {
      method: "POST",
      body: passthrough,
    }),
  );
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: parsed.error.error,
        ...(parsed.error.code ? { code: parsed.error.code } : {}),
      },
      { status: parsed.error.status },
    );
  }
  if (
    parsed.value.mode !== "image_to_image" &&
    parsed.value.mode !== "text_to_image"
  ) {
    return NextResponse.json(
      {
        error: "正式资产媒体生成仅支持文生图或图生图",
        code: "INVALID_GENERATE_MODE",
      },
      { status: 400 },
    );
  }
  const mode = parsed.value.mode;

  const draft = await loadAssetBundleForScope(input.projectId, scope);
  if (!draft) {
    return NextResponse.json({ error: "资产库不存在" }, { status: 404 });
  }
  const found = findImageableAssetInDraft(draft, assetId);
  if (!found || found.kind !== assetKindRaw) {
    return NextResponse.json(
      { error: "资产不存在或不属于指定类型", code: "ASSET_NOT_FOUND" },
      { status: 404 },
    );
  }

  const allowedMedia = assetAllowedMediaIds(found.asset);
  const referenceImages: ParsedGenerateAssetReferenceImage[] = [];
  for (const slot of parsed.value.referenceSlots) {
    if (slot.kind === "upload") {
      referenceImages.push(slot.image);
      continue;
    }
    if (slot.kind === "personal-material") {
      const resolved = await resolvePersonalMaterialReference({
        userId: input.actorUserId,
        personalMaterialId: slot.personalMaterialId,
      });
      if (!resolved.ok) {
        return NextResponse.json(
          { error: resolved.error, code: resolved.code },
          { status: resolved.status },
        );
      }
      referenceImages.push(resolved.image);
      continue;
    }
    if (slot.kind === "system-material") {
      const resolved = await resolveSystemMaterialReference({
        userId: input.actorUserId,
        materialId: slot.materialId,
      });
      if (!resolved.ok) {
        return NextResponse.json(
          { error: resolved.error, code: resolved.code },
          { status: resolved.status },
        );
      }
      referenceImages.push(resolved.image);
      continue;
    }
    const owned = allowedMedia.has(slot.mediaId);
    const sessionGen = slot.mediaId.startsWith("gen_");
    if (!owned && !sessionGen) {
      return NextResponse.json(
        {
          error: "参考图必须属于当前资产",
          code: "REFERENCE_MEDIA_FORBIDDEN",
        },
        { status: 403 },
      );
    }
    const file = await readProjectAssetImageFile(input.projectId, slot.mediaId);
    if (!file) {
      return NextResponse.json(
        { error: "无法读取参考图片", code: "REFERENCE_IMAGE_NOT_FOUND" },
        { status: 404 },
      );
    }
    referenceImages.push(file);
  }

  if (mode === "image_to_image" && referenceImages.length === 0) {
    return NextResponse.json(
      { error: "图生图至少需要 1 张参考图", code: "REFERENCE_IMAGE_REQUIRED" },
      { status: 400 },
    );
  }

  const placements = parsePlacementsField(
    readFormString(form, "sceneCharacterPlacements"),
  );
  let placementPrompt = "";
  if (assetKindRaw === "scene" && placements.length > 0) {
    const characters = draft.characters.map((c) => ({ id: c.id, name: c.name }));
    placementPrompt = buildSceneCharacterPlacementPrompt(placements, characters);

    // Attach character reference images (shot media or primary) after scene refs.
    for (const placement of placements) {
      const character = draft.characters.find(
        (c) => c.id === placement.characterAssetId,
      );
      if (!character) continue;
      const mediaId =
        readFormString(form, `characterMediaId[${placement.characterAssetId}]`) ||
        character.primaryMediaId ||
        character.imageFileName ||
        character.approvedMediaIds?.[0] ||
        null;
      if (!mediaId) continue;
      const file = await readProjectAssetImageFile(input.projectId, mediaId);
      if (file) referenceImages.push(file);
    }
  }

  const slotNumberMap =
    parsed.value.referenceSlots.length > 0
      ? `参考图编号说明：${parsed.value.referenceSlots
          .map(
            (slot, uploadIndex) =>
              `上传第${uploadIndex + 1}张=界面第${slot.index + 1}张`,
          )
          .join("；")}。用户所说的“第N张”指界面编号。`
      : "";
  const userPrompt = parsed.value.prompt.trim();
  const effectivePrompt = [slotNumberMap, userPrompt, placementPrompt]
    .filter(Boolean)
    .join("\n\n");
  if (!effectivePrompt.trim()) {
    return NextResponse.json({ error: "缺少提示词" }, { status: 400 });
  }

  const model =
    parsed.value.model && isDesignImageModelId(parsed.value.model)
      ? parsed.value.model
      : undefined;

  const reserved = await reserveImageGenerationCredits({
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    itemKey: `library:${assetId}`,
    idempotencyKey: parsed.value.idempotencyKey,
    generatedMedia: null,
    count: parsed.value.options.count,
  });
  if (!reserved.ok) return reserved.response;

  const subjectKind =
    assetKindRaw === "character"
      ? ("library_character" as const)
      : assetKindRaw === "scene"
        ? ("library_scene" as const)
        : ("library_prop" as const);

  const libraryReferenceMediaIds = parsed.value.referenceSlots.flatMap((slot) =>
    slot.kind === "media" ? [slot.mediaId] : [],
  );
  const sourceEntryRaw = readFormString(form, "sourceEntry");
  const sourceEntry =
    sourceEntryRaw === "library_look" ||
    sourceEntryRaw === "library_image" ||
    sourceEntryRaw === "storyboard_image" ||
    sourceEntryRaw === "design_item"
      ? sourceEntryRaw
      : ("library_image" as const);

  const enqueued = await createAndEnqueueImageJob({
    projectId: input.projectId,
    scope,
    subjectKind,
    subjectId: assetId,
    assetKind: assetKindRaw,
    actorUserId: input.actorUserId,
    params: {
      prompt: userPrompt,
      mode,
      model,
      quality: parsed.value.options.quality,
      aspectRatio: parsed.value.options.aspectRatio,
      count: parsed.value.options.count,
      referenceMediaIds: libraryReferenceMediaIds,
      sceneCharacterPlacementsJson:
        readFormString(form, "sceneCharacterPlacements") || null,
    },
    idempotencyKey: parsed.value.idempotencyKey,
    creditReservationId: reserved.reservationId,
    referenceImages,
    effectivePrompt,
    model,
    sourceEntry,
    libraryReferenceMediaIds,
    negativePrompt: readFormString(form, "negativePrompt") || null,
    seed: readFormString(form, "seed") || null,
  });

  if (!enqueued.ok) {
    await releaseGenerationCredits({
      reservationId: reserved.reservationId,
      projectId: input.projectId,
      reason: "library-asset-image-duplicate-blocked",
    });
    return NextResponse.json(
      {
        error: enqueued.message,
        code: enqueued.code,
        job: enqueued.job ?? null,
      },
      { status: enqueued.status },
    );
  }

  if (enqueued.reusedIdempotency) {
    await releaseGenerationCredits({
      reservationId: reserved.reservationId,
      projectId: input.projectId,
      reason: "library-asset-image-idempotent-reuse",
    });
  }

  return NextResponse.json({
    async: true,
    jobId: enqueued.job.id,
    job: publicImageJobView(enqueued.job),
  });
}

export async function runLibraryAssetMediaSave(input: {
  projectId: string;
  assetId: string;
  assetKind: LibraryAssetKind;
  mediaId: string;
  setPrimary?: boolean;
  store?: AssetBundleStoreScope;
}): Promise<NextResponse> {
  const scope = input.store ?? "management";
  if (!isSafeProjectAssetImageId(input.assetId)) {
    return NextResponse.json({ error: "无效资产 ID" }, { status: 400 });
  }
  if (!isSafeProjectAssetImageId(input.mediaId)) {
    return NextResponse.json({ error: "无效媒体 ID" }, { status: 400 });
  }

  const file = await readProjectAssetImageFile(input.projectId, input.mediaId);
  if (!file) {
    return NextResponse.json(
      { error: "媒体文件不存在", code: "MEDIA_NOT_FOUND" },
      { status: 404 },
    );
  }

  const draft = await loadAssetBundleForScope(input.projectId, scope);
  if (!draft) {
    return NextResponse.json({ error: "资产库不存在" }, { status: 404 });
  }
  const found = findImageableAssetInDraft(draft, input.assetId);
  if (!found || found.kind !== input.assetKind) {
    return NextResponse.json(
      { error: "资产不存在或不属于指定类型", code: "ASSET_NOT_FOUND" },
      { status: 404 },
    );
  }

  const setPrimary = input.setPrimary === true;
  let patched: typeof found.asset;
  let approvedMediaIds: string[];
  let primaryMediaId: string | null;

  if (
    found.kind === "character" &&
    setPrimary &&
    isAppearanceMedia(found.asset as CharacterAsset, input.mediaId)
  ) {
    const primary = resolveCharacterPrimaryMediaId(
      found.asset as CharacterAsset,
    );
    if (input.mediaId !== primary) {
      return NextResponse.json(
        {
          error: "造型图片不能设为主形象",
          code: "APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN",
        },
        { status: 400 },
      );
    }
  }

  if (found.kind === "character" && !setPrimary) {
    const nextCharacter = addCharacterLook(
      {
        ...(found.asset as CharacterAsset),
        imageMimeType:
          found.asset.imageMimeType ??
          (file.mimeType as ProjectAssetImageMime),
        imageFileName: found.asset.imageFileName ?? input.mediaId,
      },
      input.mediaId,
    );
    patched = nextCharacter;
    approvedMediaIds = nextCharacter.approvedMediaIds ?? [];
    primaryMediaId =
      nextCharacter.primaryMediaId ?? nextCharacter.imageFileName ?? null;
  } else {
    approvedMediaIds = mergeMediaIdLists(
      found.asset.approvedMediaIds,
      [input.mediaId],
      found.asset.imageFileName ? [found.asset.imageFileName] : [],
      found.asset.primaryMediaId ? [found.asset.primaryMediaId] : [],
    );
    primaryMediaId = setPrimary
      ? input.mediaId
      : found.asset.primaryMediaId ?? found.asset.imageFileName ?? null;

    patched = {
      ...found.asset,
      approvedMediaIds,
      primaryMediaId: primaryMediaId ?? undefined,
      imageFileName: setPrimary
        ? input.mediaId
        : found.asset.imageFileName ?? input.mediaId,
      imageMimeType:
        found.asset.imageMimeType ?? (file.mimeType as ProjectAssetImageMime),
    };

    if (found.kind === "character" && setPrimary) {
      patched = setCharacterPrimary(
        patched as CharacterAsset,
        input.mediaId,
      );
      approvedMediaIds =
        (patched as CharacterAsset).approvedMediaIds ?? approvedMediaIds;
      primaryMediaId =
        (patched as CharacterAsset).primaryMediaId ?? primaryMediaId;
    }
  }

  let nextDraft: AssetBundleDraft = draft;
  if (found.kind === "character") {
    nextDraft = {
      ...draft,
      characters: draft.characters.map((a) =>
        a.id === input.assetId ? (patched as typeof a) : a,
      ),
    };
  } else if (found.kind === "scene") {
    nextDraft = {
      ...draft,
      scenes: draft.scenes.map((a) =>
        a.id === input.assetId ? (patched as typeof a) : a,
      ),
    };
  } else {
    nextDraft = {
      ...draft,
      props: draft.props.map((a) =>
        a.id === input.assetId ? (patched as typeof a) : a,
      ),
    };
  }

  await saveAssetBundleForScope({
    scope,
    previous: draft,
    next: nextDraft,
  });

  const body: SaveAssetMediaResponse = {
    assetId: input.assetId,
    assetKind: input.assetKind,
    mediaId: input.mediaId,
    approvedMediaIds,
    primaryMediaId: primaryMediaId,
  };
  return NextResponse.json(body);
}
