import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  normalizeAssetBundleDraft,
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
import { loadWorkspaceLocalEpisodeDesigns } from "@/projects/workspace-sync/store";
import type {
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
} from "@/projects/assets/episode-design/types";
import { getEffectiveWorkspaceAssetBundle } from "@/projects/workspace-sync/workspace-episode-design-api";
import { getWorkspaceEpisodeAssetDesignDetail } from "@/projects/workspace-sync/workspace-episode-design-api";
import {
  workspaceAssetsPath,
  workspaceEpisodeAssetDesignsPath,
} from "@/projects/workspace-sync/paths";

export type ConfirmWorkspaceEpisodeAssetDesignResult =
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

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteTwoWorkspaceJsonFiles(params: {
  projectId: string;
  designJson: string;
  assetsJson: string;
}): Promise<void> {
  const designTarget = workspaceEpisodeAssetDesignsPath(params.projectId);
  const assetsTarget = workspaceAssetsPath(params.projectId);
  const pid = process.pid;
  const designTemp = `${designTarget}.${pid}.tmp`;
  const assetsTemp = `${assetsTarget}.${pid}.tmp`;
  const designBackup = `${designTarget}.${pid}.bak`;
  const assetsBackup = `${assetsTarget}.${pid}.bak`;

  const hadDesign = await fileExists(designTarget);
  const hadAssets = await fileExists(assetsTarget);

  await fs.writeFile(designTemp, params.designJson, "utf-8");
  await fs.writeFile(assetsTemp, params.assetsJson, "utf-8");

  if (hadDesign) await fs.rename(designTarget, designBackup);
  if (hadAssets) await fs.rename(assetsTarget, assetsBackup);

  try {
    await fs.rename(designTemp, designTarget);
    await fs.rename(assetsTemp, assetsTarget);
    if (hadDesign) await fs.unlink(designBackup).catch(() => undefined);
    if (hadAssets) await fs.unlink(assetsBackup).catch(() => undefined);
  } catch (err) {
    await fs.unlink(designTemp).catch(() => undefined);
    await fs.unlink(assetsTemp).catch(() => undefined);
    if (hadDesign && (await fileExists(designBackup))) {
      await fs.rename(designBackup, designTarget).catch(() => undefined);
    }
    if (hadAssets && (await fileExists(assetsBackup))) {
      await fs.rename(assetsBackup, assetsTarget).catch(() => undefined);
    }
    throw err;
  }
}

function findAssetById(
  bundle: ProjectAssetBundle,
  assetType: EpisodeAssetDesignItem["assetType"],
  assetId: string,
): boolean {
  switch (assetType) {
    case "character":
      return bundle.characters.some((a) => a.id === assetId);
    case "scene":
      return bundle.scenes.some((a) => a.id === assetId);
    case "prop":
      return bundle.props.some((a) => a.id === assetId);
    case "audio":
      return bundle.audios.some((a) => a.id === assetId);
  }
}

function createCharacterAsset(
  projectId: string,
  item: EpisodeAssetDesignItem & { assetType: "character" },
): CharacterAsset {
  return {
    id: randomUUID(),
    projectId,
    name: item.name,
    role: item.draft.role,
    description: item.draft.description,
    appearance: item.draft.appearance,
    clothing: item.draft.clothing,
    age: item.draft.age ?? "",
    gender: "",
    voiceId: item.draft.voiceId ?? null,
    voiceName: item.draft.voiceName ?? null,
    voiceStyle: null,
    imageFileName: null,
    imageObjectUrl: null,
    imageMimeType: null,
    status: "draft",
  };
}

function createSceneAsset(
  projectId: string,
  item: EpisodeAssetDesignItem & { assetType: "scene" },
): SceneAsset {
  return {
    id: randomUUID(),
    projectId,
    name: item.name,
    sceneType: "",
    description: item.draft.description,
    timeOfDay: item.draft.timeOfDay,
    location: item.draft.location,
    style: item.draft.style,
    imageFileName: null,
    imageObjectUrl: null,
    imageMimeType: null,
    status: "draft",
  };
}

function createPropAsset(
  projectId: string,
  item: EpisodeAssetDesignItem & { assetType: "prop" },
): PropAsset {
  return {
    id: randomUUID(),
    projectId,
    name: item.name,
    propType: item.draft.propType,
    usage: item.draft.usage,
    description: item.draft.description,
    imageFileName: null,
    imageObjectUrl: null,
    imageMimeType: null,
    status: "draft",
  };
}

function createAudioAsset(
  projectId: string,
  item: EpisodeAssetDesignItem & { assetType: "audio" },
): AudioAsset {
  return {
    id: randomUUID(),
    projectId,
    name: item.name,
    type: item.draft.audioKind,
    duration: item.draft.duration ?? "",
    source: item.draft.source ?? item.draft.description ?? "",
    fileName: null,
    objectUrl: null,
    mimeType: null,
    status: "draft",
  };
}

export async function confirmWorkspaceEpisodeAssetDesign(input: {
  projectId: string;
  episodeId: string;
  expectedRevision: number;
  userId: string;
  fingerprint: string;
}): Promise<ConfirmWorkspaceEpisodeAssetDesignResult> {
  if (isRemoteDataOnly()) {
    throw new Error("REMOTE_WORKSPACE_ASSET_CONFIRM_NOT_MIGRATED");
  }
  const detail = await getWorkspaceEpisodeAssetDesignDetail(
    input.projectId,
    input.episodeId,
  );
  if (!detail.ok) {
    return {
      ok: false,
      code: "EPISODE_DESIGN_NOT_FOUND",
      message: "该集资产设计记录不存在",
    };
  }

  const record = detail.record;
  if (
    record.status === "confirmed" &&
    record.confirmedRevision === input.expectedRevision &&
    record.contentFingerprint === input.fingerprint
  ) {
    return {
      ok: true,
      counts: { created: 0, linked: 0, ignored: 0 },
      createdAssets: [],
      record,
    };
  }

  if (record.revision !== input.expectedRevision) {
    return {
      ok: false,
      code: "REVISION_CONFLICT",
      message: "资产设计版本已变更，请刷新后重试",
    };
  }

  if (
    record.contentFingerprint &&
    record.contentFingerprint !== input.fingerprint
  ) {
    return {
      ok: false,
      code: "FINGERPRINT_STALE",
      message: "剧集正文已变更，请重新生成资产设计",
    };
  }

  for (const item of record.items) {
    if (item.resolution === "pending") {
      return {
        ok: false,
        code: "RESOLUTION_PENDING",
        message: `资产「${item.name}」尚未选择处理方式`,
      };
    }
  }

  const effectiveBundle = await getEffectiveWorkspaceAssetBundle(input.projectId);
  let bundle: ProjectAssetBundle = sanitizeAssetBundleForPersist(effectiveBundle);
  let created = 0;
  let linked = 0;
  let ignored = 0;
  const createdAssets: Array<{
    itemId: string;
    assetId: string;
    assetType: EpisodeAssetDesignItem["assetType"];
  }> = [];
  const nextItems: EpisodeAssetDesignItem[] = [];

  for (const item of record.items) {
    if (item.resolution === "ignore") {
      ignored += 1;
      nextItems.push(item);
      continue;
    }
    if (item.resolution === "link_existing") {
      const assetId = item.existingAssetId;
      if (!assetId || !findAssetById(bundle, item.assetType, assetId)) {
        return {
          ok: false,
          code: "ASSET_NOT_FOUND",
          message: `关联资产「${item.name}」不存在`,
        };
      }
      linked += 1;
      nextItems.push({ ...item, libraryAssetId: assetId });
      continue;
    }
    if (item.resolution === "create_new") {
      let createdAsset:
        | CharacterAsset
        | SceneAsset
        | PropAsset
        | AudioAsset
        | null = null;
      switch (item.assetType) {
        case "character":
          createdAsset = createCharacterAsset(input.projectId, item);
          bundle = {
            ...bundle,
            characters: [...bundle.characters, createdAsset],
          };
          break;
        case "scene":
          createdAsset = createSceneAsset(input.projectId, item);
          bundle = { ...bundle, scenes: [...bundle.scenes, createdAsset] };
          break;
        case "prop":
          createdAsset = createPropAsset(input.projectId, item);
          bundle = { ...bundle, props: [...bundle.props, createdAsset] };
          break;
        case "audio":
          createdAsset = createAudioAsset(input.projectId, item);
          bundle = { ...bundle, audios: [...bundle.audios, createdAsset] };
          break;
      }
      if (createdAsset) {
        created += 1;
        createdAssets.push({
          itemId: item.id,
          assetId: createdAsset.id,
          assetType: item.assetType,
        });
        nextItems.push({ ...item, libraryAssetId: createdAsset.id });
      } else {
        nextItems.push(item);
      }
      continue;
    }
    nextItems.push(item);
  }

  const now = new Date().toISOString();
  const nextRecord: EpisodeAssetDesignRecord = {
    ...record,
    items: nextItems,
    status: "confirmed",
    confirmedAt: now,
    confirmedBy: input.userId,
    confirmedRevision: record.revision,
    staleUpstream: false,
    updatedAt: now,
  };

  const store = await loadWorkspaceLocalEpisodeDesigns(input.projectId);
  const nextStore = upsertEpisodeRecord(store, nextRecord);
  const assetsDraft = normalizeAssetBundleDraft(input.projectId, {
    ...bundle,
    updatedAt: now,
  });
  if (!assetsDraft) {
    return {
      ok: false,
      code: "ASSET_NOT_FOUND",
      message: "资产库不存在",
    };
  }

  await atomicWriteTwoWorkspaceJsonFiles({
    projectId: input.projectId,
    designJson: JSON.stringify(nextStore, null, 2),
    assetsJson: JSON.stringify(assetsDraft, null, 2),
  });

  return {
    ok: true,
    counts: { created, linked, ignored },
    createdAssets,
    record: nextRecord,
  };
}
