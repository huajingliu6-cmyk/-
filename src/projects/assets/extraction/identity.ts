import { createHash } from "crypto";
import { normalizeAssetName, stableHash } from "@/projects/storyboard/hash";
import type { EpisodeAssetDesignAssetType } from "@/projects/assets/episode-design/types";
import type { ExtractedAsset, ExtractedAssetDraft } from "@/projects/assets/extraction/types";

export function assetIdentity(
  assetType: EpisodeAssetDesignAssetType,
  name: string,
): string {
  return `${assetType}:${normalizeAssetName(name)}`;
}

export function originalAiFingerprint(draft: ExtractedAssetDraft): string {
  return stableHash(JSON.stringify(draft));
}

export function libraryAssetIdForIdentity(identity: string): string {
  const digest = createHash("sha256").update(identity, "utf8").digest("hex");
  return `ext_${digest.slice(0, 22)}`;
}

export function withIdentity(asset: Omit<ExtractedAsset, "identity">): ExtractedAsset {
  return {
    ...asset,
    identity: assetIdentity(asset.assetType, asset.name),
  };
}
