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
import type {
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
  ProjectEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/types";

export type ConfirmEpisodeAssetDesignResult =
  | {
      ok: true;
      counts: { created: number; linked: number; ignored: number };
      createdAssets: Array<{
        itemId: string;
        assetId: string;
        assetType: EpisodeAssetDesignItem["assetType"];
      }>;
      record: EpisodeAssetDesignRecord;
    }
  | {
      ok: false;
      code:
        | "EPISODE_DESIGN_NOT_FOUND"
        | "REVISION_CONFLICT"
        | "FINGERPRINT_STALE"
        | "RESOLUTION_PENDING"
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

function createCharacterAsset(
  projectId: string,
  item: EpisodeAssetDesignItem & { assetType: "character" },
  createId: () => string,
): CharacterAsset {
  return {
    id: createId(), projectId, name: item.name, role: item.draft.role,
    description: item.draft.description, appearance: item.draft.appearance,
    clothing: item.draft.clothing, age: item.draft.age ?? "", gender: "",
    voiceId: item.draft.voiceId ?? null, voiceName: item.draft.voiceName ?? null,
    voiceStyle: null, imageFileName: null, imageObjectUrl: null,
    imageMimeType: null, status: "draft",
  };
}

function createSceneAsset(
  projectId: string,
  item: EpisodeAssetDesignItem & { assetType: "scene" },
  createId: () => string,
): SceneAsset {
  return {
    id: createId(), projectId, name: item.name, sceneType: "",
    description: item.draft.description, timeOfDay: item.draft.timeOfDay,
    location: item.draft.location, style: item.draft.style,
    imageFileName: null, imageObjectUrl: null, imageMimeType: null,
    status: "draft",
  };
}

function createPropAsset(
  projectId: string,
  item: EpisodeAssetDesignItem & { assetType: "prop" },
  createId: () => string,
): PropAsset {
  return {
    id: createId(), projectId, name: item.name, propType: item.draft.propType,
    usage: item.draft.usage, description: item.draft.description,
    imageFileName: null, imageObjectUrl: null, imageMimeType: null,
    status: "draft",
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
  if (record.status === "confirmed" && record.confirmedRevision === input.expectedRevision && record.contentFingerprint === input.fingerprint) {
    return { writeRequired: false, result: { ok: true, counts: { created: 0, linked: 0, ignored: 0 }, createdAssets: [], record } };
  }
  if (record.revision !== input.expectedRevision) {
    return { writeRequired: false, result: { ok: false, code: "REVISION_CONFLICT", message: "资产设计版本已变更，请刷新后重试" } };
  }
  if (record.contentFingerprint && record.contentFingerprint !== input.fingerprint) {
    return { writeRequired: false, result: { ok: false, code: "FINGERPRINT_STALE", message: "剧集正文已变更，请重新生成资产设计" } };
  }
  for (const item of record.items) {
    if (item.resolution === "pending") {
      return { writeRequired: false, result: { ok: false, code: "RESOLUTION_PENDING", message: `资产「${item.name}」尚未选择处理方式` } };
    }
  }

  let bundle = sanitizeAssetBundleForPersist(input.bundle);
  let created = 0;
  let linked = 0;
  let ignored = 0;
  const createdAssets: Extract<ConfirmEpisodeAssetDesignResult, { ok: true }>["createdAssets"] = [];
  const nextItems: EpisodeAssetDesignItem[] = [];
  const createId = input.createId ?? randomUUID;

  for (const item of record.items) {
    if (item.resolution === "ignore") {
      ignored += 1;
      nextItems.push(item);
      continue;
    }
    if (item.resolution === "link_existing") {
      const assetId = item.existingAssetId;
      if (!assetId || !findAssetById(bundle, item.assetType, assetId)) {
        return { writeRequired: false, result: { ok: false, code: "ASSET_NOT_FOUND", message: `关联资产「${item.name}」不存在` } };
      }
      linked += 1;
      nextItems.push({ ...item, libraryAssetId: assetId });
      continue;
    }
    if (item.resolution === "create_new") {
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
  const nextRecord: EpisodeAssetDesignRecord = {
    ...record, items: nextItems, status: "confirmed", confirmedAt: now,
    confirmedBy: input.userId, confirmedRevision: record.revision, updatedAt: now,
  };
  const result = { ok: true as const, counts: { created, linked, ignored }, createdAssets, record: nextRecord };
  return {
    writeRequired: true,
    result,
    nextStore: { ...upsertEpisodeRecord(input.store, nextRecord), updatedAt: now },
    nextBundle: { ...bundle, updatedAt: now },
  };
}
