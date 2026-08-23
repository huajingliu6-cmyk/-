import "server-only";

import { NextResponse } from "next/server";
import {
  findImageableAssetInDraft,
  isSafeProjectAssetImageId,
  deleteProjectAssetImageFile,
  readProjectAssetImageFile,
} from "@/projects/assets/asset-image-storage";
import {
  loadAssetBundleForMutation,
  saveAssetBundleForScope,
  type AssetBundleStoreScope,
} from "@/projects/assets/asset-bundle-scope";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  addCharacterLook,
  clearCharacterPrimary,
  getCharacterMediaDisplayName,
  isExclusiveGeneratedMediaBlob,
  listSortedCharacterLookMediaIds,
  normalizeCharacterMediaLists,
  removeCharacterMediaReference,
  resolveCharacterPrimaryMediaId,
  touchCharacterMediaLastUsed,
  updateCharacterMediaDisplayName,
  characterHasPrimaryMedia,
} from "@/projects/assets/character-media-state";
import {
  appendAppearanceMediaHistory,
  appendMainMediaHistory,
  confirmAppearanceMedia,
  confirmMainAppearanceMedia,
  createCharacterAppearance,
  deleteCharacterAppearance,
  ensureCharacterAppearances,
  findCharacterAppearance,
  isAppearanceMedia,
  listCharacterAppearances,
  renameCharacterAppearance,
  updateCharacterAppearancePrompt,
  syncLookMediaIdsFromAppearances,
} from "@/projects/assets/character-appearance-state";
import { isCharacterMediaSd2Certified } from "@/projects/assets/character-media-video-ref";
import { getCharacterLibraryReadiness } from "@/projects/assets/character-library-readiness";
import { decideCharacterLookBlobDeletion } from "@/projects/assets/character-look-blob-deletion";
import {
  findCharacterLookMediaUsages,
  CharacterLookReferenceScanError,
  type CharacterLookReferenceSample,
} from "@/projects/assets/character-look-reference-impact";
import { mergeMediaIdLists } from "@/projects/assets/episode-design/generated-media-history";
import {
  listImageGenerationJobs,
  readImageGenerationJob,
} from "@/projects/assets/image-generation/store";
import { markImageJobSaved } from "@/projects/assets/image-generation/process-job";
import type { CharacterAsset } from "@/projects/assets/types";
import { WorkspaceMaterializeTooLargeError } from "@/projects/workspace-sync/store";
import {
  ASSET_REVISION_CONFLICT,
  ASSET_REVISION_REQUIRED,
  isAssetRevisionError,
} from "@/projects/assets/asset-bundle-revision";

export type CharacterLookAction =
  | "set-primary"
  | "confirm-main"
  | "confirm-appearance"
  | "promote-look-to-main"
  | "history-to-look"
  | "add-look"
  | "create-appearance"
  | "delete-look"
  | "delete-appearance"
  | "clear-primary"
  | "rename-look"
  | "rename-appearance"
  | "update-appearance-prompt"
  | "append-appearance-media"
  | "append-main-media"
  | "delete-main-history";

export type CharacterLookInUseSample = CharacterLookReferenceSample;

const VIDEO_REF_REQUIRED_MESSAGE =
  "该图片尚未通过 SD 真人素材认证。请先完成人物校验并写入认证结果后再操作。";

function characterAllowedMediaIds(asset: CharacterAsset): Set<string> {
  const ensured = ensureCharacterAppearances(asset);
  const uploadKey =
    ensured.imageFileName?.trim() && ensured.id ? ensured.id : null;
  const appearanceMedia = listCharacterAppearances(ensured).flatMap((item) => [
    ...(item.currentMediaId ? [item.currentMediaId] : []),
    ...item.mediaHistory,
  ]);
  return new Set(
    mergeMediaIdLists(
      ensured.approvedMediaIds,
      ensured.historyMediaIds,
      ensured.lookMediaIds,
      appearanceMedia,
      ensured.primaryMediaId ? [ensured.primaryMediaId] : [],
      resolveCharacterPrimaryMediaId(ensured)
        ? [resolveCharacterPrimaryMediaId(ensured)!]
        : [],
      uploadKey ? [uploadKey] : [],
      ensured.imageFileName ? [ensured.imageFileName] : [],
    ),
  );
}

function patchCharacterInDraft(
  draft: AssetBundleDraft,
  characterId: string,
  next: CharacterAsset,
): AssetBundleDraft {
  return {
    ...draft,
    characters: draft.characters.map((c) =>
      c.id === characterId ? next : c,
    ),
  };
}

async function persistCharacterUpdate(
  scope: AssetBundleStoreScope,
  draft: AssetBundleDraft,
  characterId: string,
  next: CharacterAsset,
): Promise<CharacterAsset> {
  const nextDraft = patchCharacterInDraft(draft, characterId, next);
  try {
    await saveAssetBundleForScope({
      scope,
      previous: draft,
      next: nextDraft,
    });
  } catch (error) {
    if (error instanceof WorkspaceMaterializeTooLargeError) {
      throw error;
    }
    throw error;
  }
  return next;
}

function materializeTooLargeResponse(
  error: WorkspaceMaterializeTooLargeError,
): NextResponse {
  return NextResponse.json(
    {
      error: error.message,
      code: error.code,
      byteLength: error.byteLength,
      maxBytes: error.maxBytes,
      assetCount: error.assetCount,
    },
    { status: 413 },
  );
}

function videoRefRequiredResponse(): NextResponse {
  return NextResponse.json(
    {
      error: VIDEO_REF_REQUIRED_MESSAGE,
      code: "VIDEO_REF_REQUIRED",
    },
    { status: 422 },
  );
}

/** Re-export scanner for tests / callers that imported from this module. */
export { findCharacterLookMediaUsages } from "@/projects/assets/character-look-reference-impact";

async function resolveLibraryLookJob(input: {
  projectId: string;
  scope: AssetBundleStoreScope;
  characterId: string;
  mediaId: string;
  jobId?: string;
}): Promise<{ id: string } | null> {
  if (input.jobId?.trim()) {
    const job = await readImageGenerationJob(input.jobId.trim());
    if (!job) return null;
    if (job.projectId !== input.projectId) return null;
    if (job.scope !== input.scope) return null;
    if (job.subjectId !== input.characterId) return null;
    if (job.subjectKind !== "library_character") return null;
    if (job.sourceEntry !== "library_look") return null;
    const ids = [
      ...(job.mediaIds ?? []),
      ...(job.primaryMediaId ? [job.primaryMediaId] : []),
    ];
    if (!ids.includes(input.mediaId)) return null;
    return { id: job.id };
  }

  const jobs = await listImageGenerationJobs({
    projectId: input.projectId,
    scope: input.scope,
    subjectId: input.characterId,
  });
  const match = jobs.find((job) => {
    if (job.subjectKind !== "library_character") return false;
    if (job.sourceEntry !== "library_look") return false;
    const ids = [
      ...(job.mediaIds ?? []),
      ...(job.primaryMediaId ? [job.primaryMediaId] : []),
    ];
    return ids.includes(input.mediaId);
  });
  return match ? { id: match.id } : null;
}

/**
 * Stamp library_look provenance in the same in-memory character update that
 * adds look refs. Returns null when gen_* requires provenance but none found.
 */
async function stampLibraryLookProvenance(input: {
  character: CharacterAsset;
  mediaId: string;
  projectId: string;
  scope: AssetBundleStoreScope;
  jobId?: string;
  requireForGen?: boolean;
}): Promise<CharacterAsset | null> {
  const existing = input.character.mediaLookProvenance?.[input.mediaId];
  if (existing?.kind === "library_look_generation") {
    return input.character;
  }

  const match = await resolveLibraryLookJob({
    projectId: input.projectId,
    scope: input.scope,
    characterId: input.character.id,
    mediaId: input.mediaId,
    jobId: input.jobId,
  });

  if (!match) {
    if (input.requireForGen && isExclusiveGeneratedMediaBlob(input.mediaId)) {
      return null;
    }
    return input.character;
  }

  const createdAt = new Date().toISOString();
  return {
    ...input.character,
    mediaLookProvenance: {
      ...(input.character.mediaLookProvenance ?? {}),
      [input.mediaId]: {
        kind: "library_look_generation",
        jobId: match.id,
        projectId: input.projectId,
        assetId: input.character.id,
        scope: input.scope,
        createdAt,
        recordedAt: createdAt,
      },
    },
  };
}

export function listCharacterLooksForUi(asset: CharacterAsset): {
  primaryMediaId: string | null;
  lookMediaIds: string[];
  historyMediaIds: string[];
  missingPrimary: boolean;
  readiness: ReturnType<typeof getCharacterLibraryReadiness>;
  cards: Array<{
    mediaId: string;
    kind: "primary" | "look" | "history";
    displayName: string;
    lastUsedAt: string | null;
    certified: boolean;
  }>;
} {
  const normalized = normalizeCharacterMediaLists(asset);
  const primaryMediaId = resolveCharacterPrimaryMediaId(normalized);
  const lookMediaIds = listSortedCharacterLookMediaIds(normalized);
  const historyMediaIds = [...(normalized.historyMediaIds ?? [])];
  const readiness = getCharacterLibraryReadiness(normalized);
  const cards = [
    ...(primaryMediaId
      ? [
          {
            mediaId: primaryMediaId,
            kind: "primary" as const,
            displayName: getCharacterMediaDisplayName(
              normalized,
              primaryMediaId,
            ),
            lastUsedAt: normalized.mediaLastUsedAt?.[primaryMediaId] ?? null,
            certified: isCharacterMediaSd2Certified(
              normalized,
              primaryMediaId,
            ),
          },
        ]
      : []),
    ...lookMediaIds.map((mediaId) => ({
      mediaId,
      kind: "look" as const,
      displayName: getCharacterMediaDisplayName(normalized, mediaId),
      lastUsedAt: normalized.mediaLastUsedAt?.[mediaId] ?? null,
      certified: isCharacterMediaSd2Certified(normalized, mediaId),
    })),
    ...historyMediaIds.map((mediaId) => ({
      mediaId,
      kind: "history" as const,
      displayName: getCharacterMediaDisplayName(normalized, mediaId),
      lastUsedAt: normalized.mediaLastUsedAt?.[mediaId] ?? null,
      certified: isCharacterMediaSd2Certified(normalized, mediaId),
    })),
  ];
  return {
    primaryMediaId,
    lookMediaIds,
    historyMediaIds,
    missingPrimary: !characterHasPrimaryMedia(normalized),
    readiness,
    cards,
  };
}

/**
 * Unified character look mutations for management + workspace routes.
 * Caller must pass the correct store scope — workspace never writes management.
 */
export async function runCharacterLookAction(input: {
  projectId: string;
  characterId: string;
  action: CharacterLookAction;
  mediaId?: string;
  appearanceId?: string;
  displayName?: string;
  promptOverride?: string;
  /** When add-look from library_look generation — stamps provenance in same persist. */
  jobId?: string;
  store?: AssetBundleStoreScope;
}): Promise<NextResponse> {
  const scope = input.store ?? "management";
  if (!isSafeProjectAssetImageId(input.characterId)) {
    return NextResponse.json({ error: "无效角色 ID" }, { status: 400 });
  }

  let draft;
  try {
    draft = await loadAssetBundleForMutation(input.projectId, scope, {
      ensureCharacterIds: [input.characterId],
    });
  } catch (error) {
    if (error instanceof WorkspaceMaterializeTooLargeError) {
      return materializeTooLargeResponse(error);
    }
    throw error;
  }
  if (!draft) {
    return NextResponse.json({ error: "资产库不存在" }, { status: 404 });
  }

  const found = findImageableAssetInDraft(draft, input.characterId);
  if (!found || found.kind !== "character") {
    return NextResponse.json(
      { error: "角色不存在", code: "CHARACTER_NOT_FOUND" },
      { status: 404 },
    );
  }

  const character = ensureCharacterAppearances(
    normalizeCharacterMediaLists(found.asset as CharacterAsset),
  );

  const persist = async (
    next: CharacterAsset,
  ): Promise<CharacterAsset | NextResponse> => {
    try {
      return await persistCharacterUpdate(
        scope,
        draft,
        input.characterId,
        syncLookMediaIdsFromAppearances(ensureCharacterAppearances(next)),
      );
    } catch (error) {
      if (error instanceof WorkspaceMaterializeTooLargeError) {
        return materializeTooLargeResponse(error);
      }
      if (isAssetRevisionError(error)) {
        return NextResponse.json(
          {
            error: "资产数据已变更，请刷新后重试",
            code:
              error instanceof Error && error.message === ASSET_REVISION_CONFLICT
                ? ASSET_REVISION_CONFLICT
                : ASSET_REVISION_REQUIRED,
          },
          { status: 409 },
        );
      }
      throw error;
    }
  };

  if (input.action === "clear-primary") {
    const next = clearCharacterPrimary(character);
    const saved = await persist(next);
    if (saved instanceof NextResponse) return saved;
    const readiness = getCharacterLibraryReadiness(saved);
    return NextResponse.json({
      character: saved,
      missingPrimary: true,
      readiness,
      code: readiness.code === "OK" ? undefined : readiness.code,
      looks: listCharacterLooksForUi(saved),
    });
  }

  if (input.action === "create-appearance") {
    const created = createCharacterAppearance({
      asset: character,
      name: input.displayName,
      promptOverride: input.promptOverride,
      currentMediaId: null,
    });
    const saved = await persist(created.asset);
    if (saved instanceof NextResponse) return saved;
    return NextResponse.json({
      character: saved,
      appearance: findCharacterAppearance(
        saved,
        created.appearance.id,
      ),
      looks: listCharacterLooksForUi(saved),
    });
  }

  if (
    input.action === "delete-appearance" ||
    (input.action === "delete-look" && input.appearanceId)
  ) {
    const appearanceId = (input.appearanceId ?? "").trim();
    if (!appearanceId) {
      return NextResponse.json({ error: "无效造型 ID" }, { status: 400 });
    }
    const appearance = findCharacterAppearance(character, appearanceId);
    if (!appearance) {
      return NextResponse.json(
        { error: "造型不存在", code: "APPEARANCE_NOT_FOUND" },
        { status: 404 },
      );
    }
    const mediaIds = [
      ...new Set([
        ...(appearance.currentMediaId ? [appearance.currentMediaId] : []),
        ...appearance.mediaHistory,
      ]),
    ];
    for (const mediaId of mediaIds) {
      let usage;
      try {
        usage = await findCharacterLookMediaUsages({
          projectId: input.projectId,
          characterId: input.characterId,
          mediaId,
        });
      } catch (error) {
        const message =
          error instanceof CharacterLookReferenceScanError
            ? error.message
            : "扫描分镜造型引用失败，已中止删除。";
        return NextResponse.json(
          { error: message, code: "LOOK_REFERENCE_SCAN_FAILED" },
          { status: 500 },
        );
      }
      if (usage.inUse) {
        return NextResponse.json(
          {
            error: "该造型正被分镜使用，请先替换分镜媒体后再删除。",
            code: "CHARACTER_LOOK_IN_USE",
            samples: usage.samples,
            referencedShotCount: usage.referencedShotCount,
            promptMentioned: usage.promptMentioned,
          },
          { status: 409 },
        );
      }
    }
    const next = deleteCharacterAppearance(character, appearanceId);
    const focusMediaId =
      (input.mediaId ?? "").trim() ||
      appearance.currentMediaId ||
      mediaIds[0] ||
      "";

    let blobDeleted = false;
    let blobDeletion:
      | import("@/projects/assets/character-look-blob-deletion").CharacterLookBlobDeletion
      | undefined;
    let promptMentioned = false;
    if (focusMediaId) {
      const decision = await decideCharacterLookBlobDeletion({
        projectId: input.projectId,
        scope,
        character,
        mediaId: focusMediaId,
        characterAfterRemoval: next,
      });
      blobDeletion = decision.blobDeletion;
      if (decision.shouldDeleteBlob) {
        await deleteProjectAssetImageFile(input.projectId, focusMediaId).catch(
          () => undefined,
        );
        blobDeleted = true;
      }
    }
    // Best-effort cleanup for other exclusive gen blobs in the appearance.
    for (const mediaId of mediaIds) {
      if (mediaId === focusMediaId) continue;
      if (!isExclusiveGeneratedMediaBlob(mediaId)) continue;
      const decision = await decideCharacterLookBlobDeletion({
        projectId: input.projectId,
        scope,
        character,
        mediaId,
        characterAfterRemoval: next,
      });
      if (decision.shouldDeleteBlob) {
        await deleteProjectAssetImageFile(input.projectId, mediaId).catch(
          () => undefined,
        );
      }
    }

    const saved = await persist(next);
    if (saved instanceof NextResponse) return saved;
    const readiness = getCharacterLibraryReadiness(saved);
    return NextResponse.json({
      character: saved,
      missingPrimary: !characterHasPrimaryMedia(saved),
      readiness,
      blobDeleted,
      blobDeletion,
      promptMentioned,
      looks: listCharacterLooksForUi(saved),
    });
  }

  if (input.action === "rename-appearance") {
    const appearanceId = (input.appearanceId ?? "").trim();
    if (!appearanceId) {
      return NextResponse.json({ error: "无效造型 ID" }, { status: 400 });
    }
    try {
      const next = renameCharacterAppearance(
        character,
        appearanceId,
        input.displayName ?? "",
      );
      const saved = await persist(next);
      if (saved instanceof NextResponse) return saved;
      return NextResponse.json({
        character: saved,
        appearance: findCharacterAppearance(saved, appearanceId),
        looks: listCharacterLooksForUi(saved),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "APPEARANCE_NOT_FOUND") {
        return NextResponse.json(
          { error: "造型不存在", code: "APPEARANCE_NOT_FOUND" },
          { status: 404 },
        );
      }
      throw error;
    }
  }

  if (input.action === "update-appearance-prompt") {
    const appearanceId = (input.appearanceId ?? "").trim();
    if (!appearanceId) {
      return NextResponse.json({ error: "无效造型 ID" }, { status: 400 });
    }
    try {
      const next = updateCharacterAppearancePrompt(
        character,
        appearanceId,
        input.promptOverride ?? "",
      );
      const saved = await persist(next);
      if (saved instanceof NextResponse) return saved;
      return NextResponse.json({
        character: saved,
        appearance: findCharacterAppearance(saved, appearanceId),
        looks: listCharacterLooksForUi(saved),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "APPEARANCE_NOT_FOUND") {
        return NextResponse.json(
          { error: "造型不存在", code: "APPEARANCE_NOT_FOUND" },
          { status: 404 },
        );
      }
      throw error;
    }
  }

  const mediaId = (input.mediaId ?? "").trim();
  if (!mediaId || !isSafeProjectAssetImageId(mediaId)) {
    return NextResponse.json({ error: "无效媒体 ID" }, { status: 400 });
  }

  if (input.action === "rename-look") {
    const allowed = characterAllowedMediaIds(character);
    if (!allowed.has(mediaId)) {
      return NextResponse.json(
        { error: "媒体不属于当前角色", code: "MEDIA_FORBIDDEN" },
        { status: 404 },
      );
    }
    const owning = listCharacterAppearances(character).find(
      (item) =>
        item.currentMediaId === mediaId || item.mediaHistory.includes(mediaId),
    );
    let next = updateCharacterMediaDisplayName(
      character,
      mediaId,
      input.displayName ?? "",
    );
    if (owning && input.displayName?.trim()) {
      next = renameCharacterAppearance(
        next,
        owning.id,
        input.displayName.trim(),
      );
    }
    const saved = await persist(next);
    if (saved instanceof NextResponse) return saved;
    return NextResponse.json({
      character: saved,
      looks: listCharacterLooksForUi(saved),
    });
  }

  if (input.action === "append-main-media") {
    const primary = resolveCharacterPrimaryMediaId(character);
    if (isAppearanceMedia(character, mediaId) && mediaId !== primary) {
      return NextResponse.json(
        {
          error: "造型图片不能写入主形象历史",
          code: "APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN",
        },
        { status: 400 },
      );
    }
    if (!isCharacterMediaSd2Certified(character, mediaId)) {
      // Allow uncertified into history; UI gates confirm-use on cert.
    }
    const next = appendMainMediaHistory(character, mediaId);
    const saved = await persist(next);
    if (saved instanceof NextResponse) return saved;
    return NextResponse.json({
      character: saved,
      looks: listCharacterLooksForUi(saved),
    });
  }

  // Remove a media from main history only (does not delete looks/appearances).
  if (input.action === "delete-main-history") {
    const primary = resolveCharacterPrimaryMediaId(character);
    if (mediaId === primary) {
      return NextResponse.json(
        { error: "不能从历史中删除当前主形象，请先更换主形象", code: "PRIMARY_PROTECTED" },
        { status: 400 },
      );
    }
    const history = character.historyMediaIds ?? [];
    if (!history.includes(mediaId)) {
      return NextResponse.json(
        { error: "媒体不在主形象历史中", code: "NOT_IN_MAIN_HISTORY" },
        { status: 404 },
      );
    }
    // Look media that leaked into history: strip from history only.
    if (isAppearanceMedia(character, mediaId)) {
      const next = syncLookMediaIdsFromAppearances({
        ...character,
        historyMediaIds: history.filter((id) => id !== mediaId),
      });
      const saved = await persist(next);
      if (saved instanceof NextResponse) return saved;
      return NextResponse.json({
        character: saved,
        looks: listCharacterLooksForUi(saved),
      });
    }
    const next = removeCharacterMediaReference(character, mediaId);
    const decision = await decideCharacterLookBlobDeletion({
      projectId: input.projectId,
      scope,
      character,
      mediaId,
      characterAfterRemoval: next,
    });
    if (decision.shouldDeleteBlob) {
      await deleteProjectAssetImageFile(input.projectId, mediaId).catch(
        () => undefined,
      );
    }
    const saved = await persist(next);
    if (saved instanceof NextResponse) return saved;
    return NextResponse.json({
      character: saved,
      looks: listCharacterLooksForUi(saved),
    });
  }

  if (input.action === "append-appearance-media") {
    const appearanceId = (input.appearanceId ?? "").trim();
    if (!appearanceId) {
      return NextResponse.json({ error: "无效造型 ID" }, { status: 400 });
    }
    try {
      const next = appendAppearanceMediaHistory(
        character,
        appearanceId,
        mediaId,
      );
      const stamped = await stampLibraryLookProvenance({
        character: next,
        mediaId,
        projectId: input.projectId,
        scope,
        jobId: input.jobId,
        requireForGen: false,
      });
      const saved = await persist(stamped ?? next);
      if (saved instanceof NextResponse) return saved;
      return NextResponse.json({
        character: saved,
        appearance: findCharacterAppearance(saved, appearanceId),
        looks: listCharacterLooksForUi(saved),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "APPEARANCE_NOT_FOUND") {
        return NextResponse.json(
          { error: "造型不存在", code: "APPEARANCE_NOT_FOUND" },
          { status: 404 },
        );
      }
      throw error;
    }
  }

  if (input.action === "confirm-main") {
    const primary = resolveCharacterPrimaryMediaId(character);
    if (isAppearanceMedia(character, mediaId) && mediaId !== primary) {
      return NextResponse.json(
        {
          error: "造型图片不能设为主形象",
          code: "APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN",
        },
        { status: 400 },
      );
    }
    if (!isCharacterMediaSd2Certified(character, mediaId)) {
      return videoRefRequiredResponse();
    }
    try {
      const next = confirmMainAppearanceMedia(character, mediaId);
      const saved = await persist(next);
      if (saved instanceof NextResponse) return saved;
      const readiness = getCharacterLibraryReadiness(saved);
      return NextResponse.json({
        character: saved,
        readiness,
        looks: listCharacterLooksForUi(saved),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN"
      ) {
        return NextResponse.json(
          {
            error: "造型图片不能设为主形象",
            code: "APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN",
          },
          { status: 400 },
        );
      }
      throw error;
    }
  }

  // Explicit look → primary promotion (lightbox「设为主图」).
  if (input.action === "promote-look-to-main") {
    if (!isAppearanceMedia(character, mediaId)) {
      return NextResponse.json(
        { error: "仅造型图片可通过此操作设为主形象", code: "NOT_LOOK_MEDIA" },
        { status: 400 },
      );
    }
    if (!isCharacterMediaSd2Certified(character, mediaId)) {
      return videoRefRequiredResponse();
    }
    const next = confirmMainAppearanceMedia(character, mediaId, {
      allowAppearanceMedia: true,
    });
    const saved = await persist(next);
    if (saved instanceof NextResponse) return saved;
    const readiness = getCharacterLibraryReadiness(saved);
    return NextResponse.json({
      character: saved,
      readiness,
      looks: listCharacterLooksForUi(saved),
    });
  }

  if (input.action === "confirm-appearance") {
    const appearanceId = (input.appearanceId ?? "").trim();
    if (!appearanceId) {
      return NextResponse.json({ error: "无效造型 ID" }, { status: 400 });
    }
    if (!isCharacterMediaSd2Certified(character, mediaId)) {
      return videoRefRequiredResponse();
    }
    try {
      const next = confirmAppearanceMedia(character, appearanceId, mediaId);
      const saved = await persist(next);
      if (saved instanceof NextResponse) return saved;
      return NextResponse.json({
        character: saved,
        appearance: findCharacterAppearance(saved, appearanceId),
        looks: listCharacterLooksForUi(saved),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "APPEARANCE_NOT_FOUND") {
        return NextResponse.json(
          { error: "造型不存在", code: "APPEARANCE_NOT_FOUND" },
          { status: 404 },
        );
      }
      throw error;
    }
  }

  if (input.action === "delete-look") {
    const allowed = characterAllowedMediaIds(character);
    if (!allowed.has(mediaId)) {
      return NextResponse.json(
        { error: "媒体不属于当前角色", code: "MEDIA_FORBIDDEN" },
        { status: 404 },
      );
    }

    const owning = listCharacterAppearances(character).find(
      (item) =>
        item.currentMediaId === mediaId || item.mediaHistory.includes(mediaId),
    );
    if (owning) {
      // Delete the whole appearance layer (isolation), not a single media slot.
      return runCharacterLookAction({
        ...input,
        action: "delete-appearance",
        appearanceId: owning.id,
      });
    }

    let usage;
    try {
      usage = await findCharacterLookMediaUsages({
        projectId: input.projectId,
        characterId: input.characterId,
        mediaId,
      });
    } catch (error) {
      const message =
        error instanceof CharacterLookReferenceScanError
          ? error.message
          : "扫描分镜造型引用失败，已中止删除。";
      return NextResponse.json(
        {
          error: message,
          code: "LOOK_REFERENCE_SCAN_FAILED",
        },
        { status: 500 },
      );
    }

    if (usage.inUse) {
      return NextResponse.json(
        {
          error: "该造型正被分镜使用，请先替换分镜媒体后再删除。",
          code: "CHARACTER_LOOK_IN_USE",
          samples: usage.samples,
          referencedShotCount: usage.referencedShotCount,
          promptMentioned: usage.promptMentioned,
        },
        { status: 409 },
      );
    }

    if (usage.promptMentioned) {
      console.info(
        `[character-look] promptMentioned media=${mediaId} character=${input.characterId} (diagnostics only)`,
      );
    }

    const next = removeCharacterMediaReference(character, mediaId);
    const decision = await decideCharacterLookBlobDeletion({
      projectId: input.projectId,
      scope,
      character,
      mediaId,
      characterAfterRemoval: next,
    });

    const saved = await persist(next);
    if (saved instanceof NextResponse) return saved;

    let blobDeleted = false;
    if (decision.shouldDeleteBlob) {
      await deleteProjectAssetImageFile(input.projectId, mediaId).catch(
        () => undefined,
      );
      blobDeleted = true;
    }

    const readiness = getCharacterLibraryReadiness(saved);
    return NextResponse.json({
      character: saved,
      missingPrimary: !characterHasPrimaryMedia(saved),
      readiness,
      blobDeleted,
      looks: listCharacterLooksForUi(saved),
    });
  }

  // --- add-look / history-to-look / set-primary (legacy + guarded) ---

  if (input.action === "add-look") {
    const file = await readProjectAssetImageFile(input.projectId, mediaId);
    const alreadyOwned = characterAllowedMediaIds(character).has(mediaId);

    // Fast path: owned or uploaded candidate on disk — create appearance now.
    // Generated blobs with jobId fall through to continueCharacterLookAction.
    // SD2 cert is NOT required to create a look; cert gates video-ref / main confirm.
    if (alreadyOwned || file) {
      const created = createCharacterAppearance({
        asset: character,
        name: input.displayName,
        promptOverride: input.promptOverride,
        currentMediaId: mediaId,
        sourceMediaIds: [mediaId],
      });
      let next = created.asset;
      const stamped = await stampLibraryLookProvenance({
        character: next,
        mediaId,
        projectId: input.projectId,
        scope,
        jobId: input.jobId,
        requireForGen: Boolean(input.jobId?.trim()),
      });
      if (!stamped && input.jobId?.trim()) {
        return NextResponse.json(
          {
            error:
              "缺少 library_look provenance（jobId 无效或任务不是 library_look）",
            code: "LOOK_PROVENANCE_REQUIRED",
          },
          { status: 422 },
        );
      }
      next = stamped ?? next;
      next = addCharacterLook(next, mediaId);
      const saved = await persist(next);
      if (saved instanceof NextResponse) return saved;

      let jobMarkSavedFailed = false;
      const stampedJobId =
        saved.mediaLookProvenance?.[mediaId]?.jobId ?? input.jobId?.trim();
      if (stampedJobId) {
        try {
          await markImageJobSaved(stampedJobId);
        } catch (error) {
          jobMarkSavedFailed = true;
          console.error(
            `[character-look] markImageJobSaved failed job=${stampedJobId}`,
            error,
          );
        }
      }

      return NextResponse.json({
        character: saved,
        appearance: findCharacterAppearance(saved, created.appearance.id),
        looks: listCharacterLooksForUi(saved),
        jobMarkSavedFailed,
      });
    }
  }

  // Legacy job-resolved add-look / set-primary / history-to-look
  return continueCharacterLookAction({
    input,
    character,
    persist,
    scope,
    mediaId,
  });
}

async function continueCharacterLookAction(params: {
  input: {
    projectId: string;
    characterId: string;
    action: CharacterLookAction;
    mediaId?: string;
    appearanceId?: string;
    displayName?: string;
    promptOverride?: string;
    jobId?: string;
    store?: AssetBundleStoreScope;
  };
  character: CharacterAsset;
  persist: (next: CharacterAsset) => Promise<CharacterAsset | NextResponse>;
  scope: AssetBundleStoreScope;
  mediaId: string;
}): Promise<NextResponse> {
  const { input, persist, scope, mediaId } = params;
  const character = params.character;

  if (input.action === "add-look") {
    // Looks may be written before SD2 cert; video-ref / main confirm still require it.
    const file = await readProjectAssetImageFile(input.projectId, mediaId);
    if (!file) {
      return NextResponse.json(
        { error: "媒体文件不存在", code: "MEDIA_NOT_FOUND" },
        { status: 404 },
      );
    }
    const created = createCharacterAppearance({
      asset: character,
      name: input.displayName,
      promptOverride: input.promptOverride,
      currentMediaId: mediaId,
      sourceMediaIds: [mediaId],
    });
    let next = created.asset;
    const stamped = await stampLibraryLookProvenance({
      character: next,
      mediaId,
      projectId: input.projectId,
      scope,
      jobId: input.jobId,
      requireForGen: Boolean(input.jobId?.trim()),
    });
    if (!stamped && input.jobId?.trim()) {
      return NextResponse.json(
        {
          error:
            "缺少 library_look provenance（jobId 无效或任务不是 library_look）",
          code: "LOOK_PROVENANCE_REQUIRED",
        },
        { status: 422 },
      );
    }
    next = stamped ?? next;
    next = addCharacterLook(next, mediaId);
    const saved = await persist(next);
    if (saved instanceof NextResponse) return saved;

    let jobMarkSavedFailed = false;
    const stampedJobId =
      saved.mediaLookProvenance?.[mediaId]?.jobId ?? input.jobId?.trim();
    if (stampedJobId) {
      try {
        await markImageJobSaved(stampedJobId);
      } catch (error) {
        jobMarkSavedFailed = true;
        console.error(
          `[character-look] markImageJobSaved failed job=${stampedJobId}`,
          error,
        );
      }
    }

    return NextResponse.json({
      character: saved,
      appearance: findCharacterAppearance(saved, created.appearance.id),
      looks: listCharacterLooksForUi(saved),
      jobMarkSavedFailed,
    });
  }

  const allowed = characterAllowedMediaIds(character);
  if (!allowed.has(mediaId)) {
    return NextResponse.json(
      { error: "媒体不属于当前角色", code: "MEDIA_FORBIDDEN" },
      { status: 404 },
    );
  }

  try {
    let next: CharacterAsset;
    if (input.action === "set-primary" || input.action === "confirm-main") {
      if (!isCharacterMediaSd2Certified(character, mediaId)) {
        return videoRefRequiredResponse();
      }
      const primary = resolveCharacterPrimaryMediaId(character);
      if (isAppearanceMedia(character, mediaId) && mediaId !== primary) {
        return NextResponse.json(
          {
            error: "造型图片不能设为主形象",
            code: "APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN",
          },
          { status: 400 },
        );
      }
      next = confirmMainAppearanceMedia(character, mediaId);
    } else if (input.action === "history-to-look") {
      if (!isCharacterMediaSd2Certified(character, mediaId)) {
        return videoRefRequiredResponse();
      }
      // Create an independent appearance from a main-history image.
      // Do not remove the media from main history (histories stay independent).
      const created = createCharacterAppearance({
        asset: character,
        currentMediaId: mediaId,
        sourceMediaIds: [mediaId],
      });
      next = created.asset;
      const stamped = await stampLibraryLookProvenance({
        character: next,
        mediaId,
        projectId: input.projectId,
        scope,
        jobId: input.jobId,
        requireForGen: false,
      });
      next = stamped ?? next;
    } else {
      return NextResponse.json({ error: "无效请求" }, { status: 400 });
    }
    const saved = await persist(next);
    if (saved instanceof NextResponse) return saved;
    const readiness = getCharacterLibraryReadiness(saved);
    return NextResponse.json({
      character: saved,
      readiness,
      looks: listCharacterLooksForUi(saved),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN"
    ) {
      return NextResponse.json(
        {
          error: "造型图片不能设为主形象",
          code: "APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN",
        },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "NOT_IN_HISTORY") {
      return NextResponse.json(
        { error: "媒体不在历史列表中", code: "NOT_IN_HISTORY" },
        { status: 400 },
      );
    }
    if (error instanceof WorkspaceMaterializeTooLargeError) {
      return materializeTooLargeResponse(error);
    }
    throw error;
  }
}

/**
 * After shot.assetMediaIds is saved: touch lastUsed for character media only.
 * Failures are logged and must not block the shot response.
 */
export async function recordManualShotMediaUsage(input: {
  projectId: string;
  previousAssetMediaIds?: Record<string, string> | null;
  nextAssetMediaIds?: Record<string, string> | null;
  store?: AssetBundleStoreScope;
}): Promise<void> {
  const scope = input.store ?? "workspace";
  const nextMap = input.nextAssetMediaIds ?? {};
  const prevMap = input.previousAssetMediaIds ?? {};
  const touches: Array<{ characterId: string; mediaId: string }> = [];

  for (const [assetId, mediaId] of Object.entries(nextMap)) {
    if (!assetId.trim() || !mediaId.trim()) continue;
    if (prevMap[assetId] === mediaId) continue;
    touches.push({ characterId: assetId, mediaId });
  }
  if (touches.length === 0) return;

  try {
    const draft = await loadAssetBundleForMutation(input.projectId, scope, {
      ensureCharacterIds: touches.map((t) => t.characterId),
    });
    if (!draft) return;

    let changed = false;
    let characters = draft.characters;
    const at = new Date().toISOString();
    for (const touch of touches) {
      const idx = characters.findIndex((c) => c.id === touch.characterId);
      if (idx < 0) continue;
      const current = characters[idx]!;
      const allowed = characterAllowedMediaIds(current);
      if (!allowed.has(touch.mediaId)) continue;
      const updated = touchCharacterMediaLastUsed(
        current,
        touch.mediaId,
        at,
      );
      characters = characters.map((c, i) => (i === idx ? updated : c));
      changed = true;
    }
    if (!changed) return;
    await saveAssetBundleForScope({
      scope,
      previous: draft,
      next: { ...draft, characters },
    });
  } catch (error) {
    console.error(
      `[character-look] recordManualShotMediaUsage failed project=${input.projectId}`,
      error,
    );
  }
}
