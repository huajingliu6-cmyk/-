import { randomUUID } from "crypto";
import {
  sanitizeAssetBundleForPersist,
} from "@/projects/assets/asset-bundle-store";
import type {
  AudioAsset,
  CharacterAsset,
  ProjectAssetBundle,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import { upsertEpisodeRecord } from "@/projects/assets/episode-design/store";
import {
  getDesignMediaVoiceBinding,
  isMediaVoiceBound,
} from "@/projects/assets/episode-design/design-media-voice";
import { getCurrentDesignMediaVideoRefSafety } from "@/projects/assets/episode-design/design-media-video-ref-labels";
import type {
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
  ProjectEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/types";
import { listCertifiedCharacterMediaIds } from "@/projects/assets/character-media-video-ref";
import { getCharacterLibraryReadiness } from "@/projects/assets/character-library-readiness";
import { isSd2CertifiedForVideoRef } from "@/video-generation/sd2-cert-safety";

export type ConfirmLibraryGateCode =
  | "IMAGE_REQUIRED"
  | "VIDEO_REF_REQUIRED"
  | "CHARACTER_PRIMARY_REQUIRED"
  | "ASSET_TYPE_MISMATCH"
  | "ASSET_NOT_FOUND";

export type ConfirmLibraryGateFailure = {
  code: ConfirmLibraryGateCode;
  message: string;
};

export type ConfirmEpisodeAssetDesignResult =
  | {
      ok: true;
      counts: { created: number; linked: number; ignored: number };
      createdAssets: Array<{
        itemId: string;
        assetId: string;
        assetType: EpisodeAssetDesignItem["assetType"];
      }>;
      promoted: Array<{
        itemId: string;
        assetId: string;
        assetType: EpisodeAssetDesignItem["assetType"];
      }>;
      skipped: Array<{ itemId: string; code: string; message: string }>;
      failed: Array<{ itemId: string; code: string; message: string }>;
      record: EpisodeAssetDesignRecord;
    }
  | {
      ok: false;
      code:
        | "EPISODE_DESIGN_NOT_FOUND"
        | "ASSET_DESIGN_ITEM_NOT_FOUND"
        | "REVISION_CONFLICT"
        | "FINGERPRINT_STALE"
        | "RESOLUTION_PENDING"
        | "IMAGE_REQUIRED"
        | "VIDEO_REF_REQUIRED"
        | "CHARACTER_PRIMARY_REQUIRED"
        | "ASSET_TYPE_MISMATCH"
        | "ASSET_NOT_FOUND"
        | "ALREADY_CONFIRMED";
      message: string;
    };

export type ConfirmEpisodeAssetDesignTransformResult =
  | { result: ConfirmEpisodeAssetDesignResult; writeRequired: false }
  | {
      result: Extract<ConfirmEpisodeAssetDesignResult, { ok: true }>;
      writeRequired: true;
      nextStore: ProjectEpisodeAssetDesignStore;
      nextBundle: ProjectAssetBundle & { updatedAt: string };
    };

const EMPTY_OK_LISTS = {
  createdAssets: [] as Extract<ConfirmEpisodeAssetDesignResult, { ok: true }>["createdAssets"],
  promoted: [] as Extract<ConfirmEpisodeAssetDesignResult, { ok: true }>["promoted"],
  skipped: [] as Extract<ConfirmEpisodeAssetDesignResult, { ok: true }>["skipped"],
  failed: [] as Extract<ConfirmEpisodeAssetDesignResult, { ok: true }>["failed"],
};

function assetHasLibraryImage(
  asset: Pick<
    CharacterAsset | SceneAsset | PropAsset,
    "imageFileName" | "primaryMediaId" | "approvedMediaIds"
  >,
): boolean {
  if (asset.imageFileName?.trim()) return true;
  if (asset.primaryMediaId?.trim()) return true;
  return (asset.approvedMediaIds ?? []).some((id) => id.trim().length > 0);
}

/**
 * Library promotion gate for create_new items.
 * Always requires image for character/scene/prop; characters also need SD2.
 * Audio is not gated. Returns null when the item may be promoted.
 */
/** Batch extract confirm may still create draft library rows without images. */
export function shouldBatchSkipCreateNewOnLibraryGate(
  item: EpisodeAssetDesignItem,
  gate: ConfirmLibraryGateFailure,
): boolean {
  if (
    gate.code === "IMAGE_REQUIRED" &&
    !item.generatedMedia?.currentId?.trim()
  ) {
    return false;
  }
  return true;
}

export function assertDesignItemLibraryGate(
  item: EpisodeAssetDesignItem,
): ConfirmLibraryGateFailure | null {
  if (item.resolution !== "create_new") return null;
  if (item.assetType === "audio") return null;

  const mediaId = item.generatedMedia?.currentId?.trim() || null;

  if (!mediaId) {
    return {
      code: "IMAGE_REQUIRED",
      message: `资产「${item.name}」尚未生成图片，无法确认入库`,
    };
  }

  if (
    item.assetType === "character" &&
    !isSd2CertifiedForVideoRef(
      getCurrentDesignMediaVideoRefSafety(item.generatedMedia),
    )
  ) {
    return {
      code: "VIDEO_REF_REQUIRED",
      message: `资产「${item.name}」尚未通过人物参考校验，无法确认入库`,
    };
  }

  return null;
}

/**
 * Gate for link_existing: target formal asset must exist, match type, and
 * satisfy library image / SD2 rules.
 */
export function assertLinkExistingLibraryGate(
  bundle: ProjectAssetBundle,
  item: EpisodeAssetDesignItem,
): ConfirmLibraryGateFailure | null {
  if (item.resolution !== "link_existing") return null;

  const assetId = item.existingAssetId?.trim() || "";
  if (!assetId) {
    return {
      code: "ASSET_NOT_FOUND",
      message: `关联资产「${item.name}」不存在`,
    };
  }

  switch (item.assetType) {
    case "character": {
      const character = bundle.characters.find((asset) => asset.id === assetId);
      if (!character) {
        if (
          bundle.scenes.some((a) => a.id === assetId) ||
          bundle.props.some((a) => a.id === assetId) ||
          bundle.audios.some((a) => a.id === assetId)
        ) {
          return {
            code: "ASSET_TYPE_MISMATCH",
            message: `关联资产「${item.name}」类型不匹配`,
          };
        }
        return {
          code: "ASSET_NOT_FOUND",
          message: `关联资产「${item.name}」不存在`,
        };
      }
      if (listCertifiedCharacterMediaIds(character).length === 0) {
        return {
          code: "VIDEO_REF_REQUIRED",
          message: `关联角色「${item.name}」尚无已通过人物参考校验的正式图片，无法关联`,
        };
      }
      const readiness = getCharacterLibraryReadiness(character);
      if (!readiness.readyForLibrary) {
        if (readiness.code === "CHARACTER_PRIMARY_REQUIRED") {
          return {
            code: "CHARACTER_PRIMARY_REQUIRED",
            message: `关联角色「${item.name}」缺少主图，无法入库/确认`,
          };
        }
        if (readiness.code === "VIDEO_REF_REQUIRED") {
          return {
            code: "VIDEO_REF_REQUIRED",
            message: `关联角色「${item.name}」主图尚未通过人物参考校验，无法关联`,
          };
        }
        return {
          code: "VIDEO_REF_REQUIRED",
          message:
            readiness.reason ??
            `关联角色「${item.name}」未满足入库条件，无法关联`,
        };
      }
      return null;
    }
    case "scene": {
      const scene = bundle.scenes.find((asset) => asset.id === assetId);
      if (!scene) {
        if (
          bundle.characters.some((a) => a.id === assetId) ||
          bundle.props.some((a) => a.id === assetId) ||
          bundle.audios.some((a) => a.id === assetId)
        ) {
          return {
            code: "ASSET_TYPE_MISMATCH",
            message: `关联资产「${item.name}」类型不匹配`,
          };
        }
        return {
          code: "ASSET_NOT_FOUND",
          message: `关联资产「${item.name}」不存在`,
        };
      }
      if (!assetHasLibraryImage(scene)) {
        return {
          code: "IMAGE_REQUIRED",
          message: `关联场景「${item.name}」尚无有效图片，无法关联`,
        };
      }
      return null;
    }
    case "prop": {
      const prop = bundle.props.find((asset) => asset.id === assetId);
      if (!prop) {
        if (
          bundle.characters.some((a) => a.id === assetId) ||
          bundle.scenes.some((a) => a.id === assetId) ||
          bundle.audios.some((a) => a.id === assetId)
        ) {
          return {
            code: "ASSET_TYPE_MISMATCH",
            message: `关联资产「${item.name}」类型不匹配`,
          };
        }
        return {
          code: "ASSET_NOT_FOUND",
          message: `关联资产「${item.name}」不存在`,
        };
      }
      if (!assetHasLibraryImage(prop)) {
        return {
          code: "IMAGE_REQUIRED",
          message: `关联道具「${item.name}」尚无有效图片，无法关联`,
        };
      }
      return null;
    }
    case "audio": {
      const audio = bundle.audios.find((asset) => asset.id === assetId);
      if (!audio) {
        if (
          bundle.characters.some((a) => a.id === assetId) ||
          bundle.scenes.some((a) => a.id === assetId) ||
          bundle.props.some((a) => a.id === assetId)
        ) {
          return {
            code: "ASSET_TYPE_MISMATCH",
            message: `关联资产「${item.name}」类型不匹配`,
          };
        }
        return {
          code: "ASSET_NOT_FOUND",
          message: `关联资产「${item.name}」不存在`,
        };
      }
      return null;
    }
  }
}

function findAssetById(
  bundle: ProjectAssetBundle,
  assetType: EpisodeAssetDesignItem["assetType"],
  assetId: string,
): boolean {
  switch (assetType) {
    case "character":
      return bundle.characters.some((asset) => asset.id === assetId);
    case "scene":
      return bundle.scenes.some((asset) => asset.id === assetId);
    case "prop":
      return bundle.props.some((asset) => asset.id === assetId);
    case "audio":
      return bundle.audios.some((asset) => asset.id === assetId);
  }
}

function itemResolvedInLibrary(
  bundle: ProjectAssetBundle,
  item: EpisodeAssetDesignItem,
): boolean {
  if (item.resolution === "ignore") return true;
  const assetId = item.libraryAssetId?.trim();
  if (!assetId) return false;
  return findAssetById(bundle, item.assetType, assetId);
}

function createCharacterAsset(
  projectId: string,
  item: EpisodeAssetDesignItem & { assetType: "character" },
  createId: () => string,
): CharacterAsset {
  const mediaId = item.generatedMedia?.currentId?.trim() || null;
  const mediaEntry = item.generatedMedia?.history?.find(
    (entry) => entry.mediaId === mediaId,
  );
  const binding = getDesignMediaVoiceBinding(item, mediaId ?? "");
  const voiceBound = isMediaVoiceBound(binding);
  const videoRefSafety = getCurrentDesignMediaVideoRefSafety(item.generatedMedia);
  return {
    id: createId(), projectId, name: item.name, role: item.draft.role,
    description: item.draft.description, appearance: item.draft.appearance,
    clothing: item.draft.clothing, age: item.draft.age ?? "", gender: "",
    voiceId: voiceBound ? binding.voiceId : null,
    voiceName: voiceBound ? binding.voiceName : null,
    voiceStyle: null,
    ...(voiceBound && mediaId
      ? { mediaVoices: { [mediaId]: { voiceId: binding.voiceId, voiceName: binding.voiceName } } }
      : {}),
    imageFileName: mediaId, imageObjectUrl: null,
    imageMimeType: mediaId
      ? mediaEntry?.mimeType ?? item.generatedMedia?.mimeType ?? "image/png"
      : null,
    ...(mediaId ? { approvedMediaIds: [mediaId], primaryMediaId: mediaId } : {}),
    ...(videoRefSafety ? { videoRefSafety } : {}),
    ...(mediaId && videoRefSafety
      ? { mediaVideoRefSafety: { [mediaId]: videoRefSafety } }
      : {}),
    status: mediaId ? "completed" : "draft",
  };
}

function createSceneAsset(
  projectId: string,
  item: EpisodeAssetDesignItem & { assetType: "scene" },
  createId: () => string,
): SceneAsset {
  const mediaId = item.generatedMedia?.currentId?.trim() || null;
  const mediaEntry = item.generatedMedia?.history?.find(
    (entry) => entry.mediaId === mediaId,
  );
  return {
    id: createId(), projectId, name: item.name, sceneType: "",
    description: item.draft.description, timeOfDay: item.draft.timeOfDay,
    location: item.draft.location, style: item.draft.style,
    imageFileName: mediaId, imageObjectUrl: null,
    imageMimeType: mediaId
      ? mediaEntry?.mimeType ?? item.generatedMedia?.mimeType ?? "image/png"
      : null,
    ...(mediaId ? { approvedMediaIds: [mediaId], primaryMediaId: mediaId } : {}),
    status: mediaId ? "completed" : "draft",
  };
}

function createPropAsset(
  projectId: string,
  item: EpisodeAssetDesignItem & { assetType: "prop" },
  createId: () => string,
): PropAsset {
  const mediaId = item.generatedMedia?.currentId?.trim() || null;
  const mediaEntry = item.generatedMedia?.history?.find(
    (entry) => entry.mediaId === mediaId,
  );
  return {
    id: createId(), projectId, name: item.name, propType: item.draft.propType,
    usage: item.draft.usage, description: item.draft.description,
    imageFileName: mediaId, imageObjectUrl: null,
    imageMimeType: mediaId
      ? mediaEntry?.mimeType ?? item.generatedMedia?.mimeType ?? "image/png"
      : null,
    ...(mediaId ? { approvedMediaIds: [mediaId], primaryMediaId: mediaId } : {}),
    status: mediaId ? "completed" : "draft",
  };
}

function createAudioAsset(
  projectId: string,
  item: EpisodeAssetDesignItem & { assetType: "audio" },
  createId: () => string,
): AudioAsset {
  return {
    id: createId(), projectId, name: item.name, type: item.draft.audioKind,
    duration: item.draft.duration ?? "",
    source: item.draft.source ?? item.draft.description ?? "",
    fileName: null, objectUrl: null, mimeType: null, status: "draft",
  };
}

export function transformEpisodeAssetDesignConfirmation(input: {
  projectId: string;
  episodeId: string;
  expectedRevision: number;
  userId: string;
  fingerprint: string;
  /** Personal projects may confirm one card without closing the whole record. */
  itemId?: string;
  store: ProjectEpisodeAssetDesignStore;
  bundle: ProjectAssetBundle;
  now?: string;
  createId?: () => string;
}): ConfirmEpisodeAssetDesignTransformResult {
  const record = input.store.records.find(
    (candidate) => candidate.episodeId === input.episodeId,
  );
  if (!record) {
    return { writeRequired: false, result: { ok: false, code: "EPISODE_DESIGN_NOT_FOUND", message: "该集资产设计记录不存在" } };
  }
  if (!input.itemId && record.status === "confirmed" && record.confirmedRevision === input.expectedRevision && record.contentFingerprint === input.fingerprint) {
    return {
      writeRequired: false,
      result: {
        ok: true,
        counts: { created: 0, linked: 0, ignored: 0 },
        ...EMPTY_OK_LISTS,
        record,
      },
    };
  }
  if (record.revision !== input.expectedRevision) {
    return { writeRequired: false, result: { ok: false, code: "REVISION_CONFLICT", message: "资产设计版本已变更，请刷新后重试" } };
  }
  if (record.contentFingerprint && record.contentFingerprint !== input.fingerprint) {
    return { writeRequired: false, result: { ok: false, code: "FINGERPRINT_STALE", message: "剧集正文已变更，请重新生成资产设计" } };
  }
  const targetItem = input.itemId
    ? record.items.find((item) => item.id === input.itemId)
    : null;
  if (input.itemId && !targetItem) {
    return {
      writeRequired: false,
      result: {
        ok: false,
        code: "ASSET_DESIGN_ITEM_NOT_FOUND",
        message: "资产设计项不存在",
      },
    };
  }
  if (
    targetItem?.libraryAssetId &&
    findAssetById(input.bundle, targetItem.assetType, targetItem.libraryAssetId)
  ) {
    return {
      writeRequired: false,
      result: {
        ok: true,
        counts: { created: 0, linked: 0, ignored: 0 },
        ...EMPTY_OK_LISTS,
        record,
      },
    };
  }

  const itemsToConfirm = targetItem ? [targetItem] : record.items;
  for (const item of itemsToConfirm) {
    if (item.resolution === "pending") {
      return { writeRequired: false, result: { ok: false, code: "RESOLUTION_PENDING", message: `资产「${item.name}」尚未选择处理方式` } };
    }
  }

  // Single-item confirm: hard-fail library gates before writing.
  if (input.itemId && targetItem) {
    if (targetItem.resolution === "create_new") {
      const gate = assertDesignItemLibraryGate(targetItem);
      if (gate) {
        return {
          writeRequired: false,
          result: { ok: false, code: gate.code, message: gate.message },
        };
      }
    }
    if (targetItem.resolution === "link_existing") {
      const gate = assertLinkExistingLibraryGate(input.bundle, targetItem);
      if (gate) {
        return {
          writeRequired: false,
          result: { ok: false, code: gate.code, message: gate.message },
        };
      }
    }
  }

  let bundle = sanitizeAssetBundleForPersist(input.bundle);
  let created = 0;
  let linked = 0;
  let ignored = 0;
  const createdAssets: Extract<ConfirmEpisodeAssetDesignResult, { ok: true }>["createdAssets"] = [];
  const skipped: Extract<ConfirmEpisodeAssetDesignResult, { ok: true }>["skipped"] = [];
  const failed: Extract<ConfirmEpisodeAssetDesignResult, { ok: true }>["failed"] = [];
  const nextItems: EpisodeAssetDesignItem[] = [];
  const createId = input.createId ?? randomUUID;

  for (const item of record.items) {
    if (targetItem && item.id !== targetItem.id) {
      nextItems.push(item);
      continue;
    }
    if (
      item.libraryAssetId &&
      findAssetById(bundle, item.assetType, item.libraryAssetId)
    ) {
      nextItems.push(item);
      continue;
    }
    if (item.resolution === "ignore") {
      ignored += 1;
      nextItems.push(item);
      continue;
    }
    if (item.resolution === "link_existing") {
      const gate = assertLinkExistingLibraryGate(bundle, item);
      if (gate) {
        if (input.itemId) {
          return {
            writeRequired: false,
            result: { ok: false, code: gate.code, message: gate.message },
          };
        }
        skipped.push({
          itemId: item.id,
          code: gate.code,
          message: gate.message,
        });
        nextItems.push(item);
        continue;
      }
      const assetId = item.existingAssetId!.trim();
      linked += 1;
      nextItems.push({ ...item, libraryAssetId: assetId });
      continue;
    }
    if (item.resolution === "create_new") {
      const gate = assertDesignItemLibraryGate(item);
      if (gate && shouldBatchSkipCreateNewOnLibraryGate(item, gate)) {
        // Batch: skip items that fail image/SD2 gates when media exists.
        // Single-item was already hard-failed above.
        skipped.push({
          itemId: item.id,
          code: gate.code,
          message: gate.message,
        });
        nextItems.push(item);
        continue;
      }
      let createdAsset: CharacterAsset | SceneAsset | PropAsset | AudioAsset;
      switch (item.assetType) {
        case "character":
          createdAsset = createCharacterAsset(input.projectId, item, createId);
          bundle = { ...bundle, characters: [...bundle.characters, createdAsset] };
          break;
        case "scene":
          createdAsset = createSceneAsset(input.projectId, item, createId);
          bundle = { ...bundle, scenes: [...bundle.scenes, createdAsset] };
          break;
        case "prop":
          createdAsset = createPropAsset(input.projectId, item, createId);
          bundle = { ...bundle, props: [...bundle.props, createdAsset] };
          break;
        case "audio":
          createdAsset = createAudioAsset(input.projectId, item, createId);
          bundle = { ...bundle, audios: [...bundle.audios, createdAsset] };
          break;
      }
      created += 1;
      createdAssets.push({ itemId: item.id, assetId: createdAsset.id, assetType: item.assetType });
      nextItems.push({ ...item, libraryAssetId: createdAsset.id });
      continue;
    }
    nextItems.push(item);
  }

  const now = input.now ?? new Date().toISOString();
  const allNonIgnoreResolved =
    !targetItem &&
    nextItems.every((item) => itemResolvedInLibrary(bundle, item)) &&
    skipped.length === 0 &&
    failed.length === 0;

  const nextRecord: EpisodeAssetDesignRecord = {
    ...record,
    items: nextItems,
    ...(targetItem
      ? {}
      : allNonIgnoreResolved
        ? {
            status: "confirmed" as const,
            confirmedAt: now,
            confirmedBy: input.userId,
            confirmedRevision: record.revision,
          }
        : {
            status: "review" as const,
            confirmedAt: null,
            confirmedBy: null,
            confirmedRevision: null,
          }),
    updatedAt: now,
  };
  const result = {
    ok: true as const,
    counts: { created, linked, ignored },
    createdAssets,
    promoted: createdAssets,
    skipped,
    failed,
    record: nextRecord,
  };
  return {
    writeRequired: true,
    result,
    nextStore: { ...upsertEpisodeRecord(input.store, nextRecord), updatedAt: now },
    nextBundle: { ...bundle, updatedAt: now },
  };
}
