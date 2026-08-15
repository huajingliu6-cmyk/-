import "server-only";

import { NextResponse } from "next/server";
import {
  findImageableAssetInDraft,
  readProjectAssetImageFile,
  deleteProjectAssetImageFile,
  isSafeProjectAssetImageId,
  type ProjectAssetImageMime,
} from "@/projects/assets/asset-image-storage";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
  type AssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import { synchronizeAssetDraftDownstream } from "@/projects/assets/asset-draft-downstream";
import { generateDesignAssetImage } from "@/projects/assets/episode-design/generate-design-asset-image";
import {
  parseGenerateAssetRequest,
  type ParsedGenerateAssetReferenceImage,
} from "@/projects/assets/episode-design/parse-generate-asset-request";
import { isDesignImageModelId } from "@/projects/assets/episode-design/image-generation-models";
import { mergeMediaIdLists } from "@/projects/assets/episode-design/generated-media-history";
import {
  releaseGenerationCredits,
  reserveImageGenerationCredits,
  settleGenerationCredits,
} from "@/credits/generation-billing";
import { estimateAssetImageCredits } from "@/credits/generation-pricing";
import { buildSceneCharacterPlacementPrompt } from "@/projects/storyboard/scene-character-placements";
import type { SceneCharacterPlacement } from "@/projects/storyboard/types";

export type LibraryAssetKind = "character" | "prop" | "scene";

export type AssetImageGenerationResponse = {
  mediaId: string;
  mediaIds: string[];
  images: Array<{ mediaId: string; mimeType: string }>;
  mode: "image_to_image";
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

async function deleteBatchImages(projectId: string, mediaIds: string[]) {
  await Promise.all(
    mediaIds.map((mediaId) =>
      deleteProjectAssetImageFile(projectId, mediaId).catch(() => undefined),
    ),
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
 * Formal library asset image-to-image generation (storyboard right-click editor).
 * Reuses parseGenerateAssetRequest + generateDesignAssetImage + billing.
 */
export async function runLibraryAssetMediaGenerate(input: {
  request: Request;
  projectId: string;
  actorUserId: string;
}): Promise<NextResponse> {
  const contentType = (input.request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "图生图须使用 multipart/form-data", code: "MULTIPART_REQUIRED" },
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

  const mode = readFormString(form, "mode") || "image_to_image";
  if (mode !== "image_to_image") {
    return NextResponse.json(
      {
        error: "正式资产媒体生成仅支持图生图",
        code: "IMAGE_TO_IMAGE_REQUIRED",
      },
      { status: 400 },
    );
  }

  // Rebuild a Request so parseGenerateAssetRequest can consume FormData again.
  const passthrough = new FormData();
  for (const [key, value] of form.entries()) {
    passthrough.append(key, value);
  }
  if (!passthrough.has("mode")) passthrough.set("mode", "image_to_image");
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
  if (parsed.value.mode !== "image_to_image") {
    return NextResponse.json(
      {
        error: "正式资产媒体生成仅支持图生图",
        code: "IMAGE_TO_IMAGE_REQUIRED",
      },
      { status: 400 },
    );
  }

  const draft = await loadAssetBundleDraft(input.projectId);
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

  if (referenceImages.length === 0) {
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

  let generated: Awaited<ReturnType<typeof generateDesignAssetImage>>;
  try {
    generated = await generateDesignAssetImage({
      projectId: input.projectId,
      assetType: assetKindRaw,
      assetName: found.asset.name,
      prompt: effectivePrompt,
      quality: parsed.value.options.quality,
      aspectRatio: parsed.value.options.aspectRatio,
      count: parsed.value.options.count,
      model,
      referenceImages,
    });
  } catch (error) {
    await releaseGenerationCredits({
      reservationId: reserved.reservationId,
      projectId: input.projectId,
      reason: "library-asset-image-provider-failed",
    });
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500;
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : "IMAGE_GENERATION_FAILED";
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "资产生成失败",
        code,
      },
      { status },
    );
  }

  const mediaIds = generated.images.map((image) => image.mediaId);
  try {
    const actualPoints = estimateAssetImageCredits(null, generated.count).points;
    const credit = await settleGenerationCredits({
      reservationId: reserved.reservationId,
      projectId: input.projectId,
      actualPoints,
      reason: "library-asset-image-generation-settle",
      knownBalance: reserved.balance,
    });

    const body: AssetImageGenerationResponse & {
      credit?: unknown;
      notice?: string;
    } = {
      mediaId: generated.mediaId,
      mediaIds,
      images: generated.images.map((image) => ({
        mediaId: image.mediaId,
        mimeType: image.mimeType,
      })),
      mode: "image_to_image",
      generatedAt: new Date().toISOString(),
      notice: generated.notice,
      credit,
    };
    return NextResponse.json(body);
  } catch (error) {
    await deleteBatchImages(input.projectId, mediaIds);
    await releaseGenerationCredits({
      reservationId: reserved.reservationId,
      projectId: input.projectId,
      reason: "library-asset-image-settle-failed",
    });
    throw error;
  }
}

export async function runLibraryAssetMediaSave(input: {
  projectId: string;
  assetId: string;
  assetKind: LibraryAssetKind;
  mediaId: string;
  setPrimary?: boolean;
}): Promise<NextResponse> {
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

  const draft = await loadAssetBundleDraft(input.projectId);
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

  const approvedMediaIds = mergeMediaIdLists(
    found.asset.approvedMediaIds,
    [input.mediaId],
    found.asset.imageFileName ? [found.asset.imageFileName] : [],
    found.asset.primaryMediaId ? [found.asset.primaryMediaId] : [],
  );
  const setPrimary = input.setPrimary === true;
  const primaryMediaId = setPrimary
    ? input.mediaId
    : found.asset.primaryMediaId ?? found.asset.imageFileName ?? null;

  const patched = {
    ...found.asset,
    approvedMediaIds,
    primaryMediaId: primaryMediaId ?? undefined,
    imageFileName: found.asset.imageFileName ?? input.mediaId,
    imageMimeType:
      found.asset.imageMimeType ?? (file.mimeType as ProjectAssetImageMime),
  };

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

  await saveAssetBundleDraft(nextDraft);
  await synchronizeAssetDraftDownstream({
    projectId: input.projectId,
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
