import { randomUUID } from "crypto";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import {
  loadEpisodeAssetDesignStore,
  saveEpisodeAssetDesignStore,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import type { EpisodeAssetDesignRecord } from "@/projects/assets/episode-design/types";
import { designItemToExtractedAsset } from "@/projects/assets/extraction/items";
import { mergeExtractedAssets } from "@/projects/assets/extraction/merge";
import { materializeActiveVersionToBundle } from "@/projects/assets/extraction/materialize";
import {
  emptyAssetExtractionStore,
  loadAssetExtractionStore,
  mutateAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import {
  ASSET_EXTRACTION_UPGRADE_MESSAGE,
  type AssetExtractionStore,
  type AssetManualOverride,
} from "@/projects/assets/extraction/types";

const LEGACY_FULL_SCRIPT_EPISODE_ID = "__full_script__";

export async function ensureAssetExtractionMigrated(
  projectId: string,
): Promise<AssetExtractionStore> {
  const current = await loadAssetExtractionStore(projectId);
  if (current.migratedFromLegacy) {
    return current;
  }

  const designStore = await loadEpisodeAssetDesignStore(projectId);
  const now = new Date().toISOString();
  let nextDesign = designStore;
  let designDirty = false;

  for (const record of designStore.records) {
    if (record.status !== "generating") continue;
    designDirty = true;
    const failed: EpisodeAssetDesignRecord = {
      ...record,
      status: "failed",
      activeGeneration: null,
      generationId: null,
      revision: record.revision + 1,
      updatedAt: now,
    };
    nextDesign = upsertEpisodeRecord(nextDesign, failed);
  }
  if (designDirty) {
    await saveEpisodeAssetDesignStore(nextDesign);
  }

  const extracted = mergeExtractedAssets(
    nextDesign.records
      .filter((record) => record.items.length > 0)
      .map((record) =>
        record.items.map((item) =>
          designItemToExtractedAsset(
            item,
            record.episodeId === LEGACY_FULL_SCRIPT_EPISODE_ID
              ? null
              : record.episodeId,
          ),
        ),
      ),
  );

  const overrides: AssetManualOverride[] = [];
  for (const record of nextDesign.records) {
    for (const item of record.items) {
      if (item.source !== "manual") continue;
      const asset = designItemToExtractedAsset(item, record.episodeId);
      overrides.push({
        projectId,
        versionId: "",
        fields: { draft: item.draft, name: item.name },
        assetIdentity: asset.identity,
        originalAiFingerprint: asset.originalAiFingerprint,
        updatedAt: now,
      });
    }
  }

  const fullScriptFingerprint =
    nextDesign.records.find(
      (record) => record.episodeId === LEGACY_FULL_SCRIPT_EPISODE_ID,
    )?.contentFingerprint ??
    nextDesign.records.find((record) => record.contentFingerprint)
      ?.contentFingerprint ??
    "";

  const versionId = extracted.length > 0 ? randomUUID() : null;
  const next = await mutateAssetExtractionStore(projectId, (store) => {
    if (store.migratedFromLegacy) return store;
    const base = emptyAssetExtractionStore(projectId);
    const failedLegacyTasks = store.tasks.map((task) =>
      task.status === "queued" ||
      task.status === "generating" ||
      task.status === "applying" ||
      task.status === "discovering" ||
      task.status === "discovering_roster" ||
      task.status === "merging_roster" ||
      task.status === "extracting_details" ||
      task.status === "retrying_failed" ||
      task.status === "retrying_failed_once" ||
      task.status === "saving"
        ? {
            ...task,
            status: "failed" as const,
            errorMessage: ASSET_EXTRACTION_UPGRADE_MESSAGE,
            updatedAt: now,
            revision: task.revision + 1,
          }
        : task,
    );
    if (!versionId) {
      return {
        ...base,
        tasks: failedLegacyTasks,
        migratedFromLegacy: true,
      };
    }
    return {
      ...base,
      migratedFromLegacy: true,
      tasks: failedLegacyTasks,
      versions: [
        {
          id: versionId,
          projectId,
          sourceFingerprint: fullScriptFingerprint,
          status: "active",
          modelKey: "deepseek-v4-pro",
          attempt: 1,
          createdAt: now,
        },
      ],
      results: [
        {
          versionId,
          scope: "all",
          episodeId: null,
          assets: extracted.filter((asset) => asset.sourceEpisodeIds.length === 0),
        },
        ...groupEpisodeResults(versionId, extracted),
      ],
      overrides: overrides.map((override) => ({
        ...override,
        versionId: versionId!,
      })),
    };
  });

  if (versionId && extracted.length > 0) {
    await materializeActiveVersionToBundle(projectId, next);
  } else {
    await loadAssetBundleDraft(projectId).catch(() => null);
  }

  return next;
}

function groupEpisodeResults(
  versionId: string,
  assets: ReturnType<typeof mergeExtractedAssets>,
) {
  const byEpisode = new Map<string, typeof assets>();
  for (const asset of assets) {
    for (const episodeId of asset.sourceEpisodeIds) {
      const list = byEpisode.get(episodeId) ?? [];
      list.push(asset);
      byEpisode.set(episodeId, list);
    }
  }
  return [...byEpisode.entries()].map(([episodeId, episodeAssets]) => ({
    versionId,
    scope: "episode" as const,
    episodeId,
    assets: episodeAssets,
  }));
}
