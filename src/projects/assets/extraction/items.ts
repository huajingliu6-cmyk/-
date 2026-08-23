import { randomUUID } from "crypto";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import {
  assetIdentity,
  originalAiFingerprint,
} from "@/projects/assets/extraction/identity";
import type { ExtractedAsset } from "@/projects/assets/extraction/types";

const LEGACY_FULL_SCRIPT_EPISODE_ID = "__full_script__";

export function designItemToExtractedAsset(
  item: EpisodeAssetDesignItem,
  sourceEpisodeId: string | null,
): ExtractedAsset {
  const sourceEpisodeIds =
    sourceEpisodeId && sourceEpisodeId !== LEGACY_FULL_SCRIPT_EPISODE_ID
      ? [sourceEpisodeId]
      : [];
  return {
    identity: assetIdentity(item.assetType, item.name),
    assetType: item.assetType,
    name: item.name,
    draft: item.draft,
    originalAiFingerprint: originalAiFingerprint(item.draft),
    sourceEpisodeIds,
    libraryAssetId: item.libraryAssetId ?? item.existingAssetId ?? null,
  };
}

export function newVersionId(): string {
  return randomUUID();
}

export function newTaskId(): string {
  return randomUUID();
}
