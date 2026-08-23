/**
 * Per-media SD2 person-certification state for CharacterAsset.
 * Authority lives on mediaVideoRefSafety[mediaId]; legacy top-level
 * videoRefSafety is only a compatibility mirror for the current primary.
 */

import type { CharacterAsset, VideoRefSafety } from "@/projects/assets/types";
import { isSd2CertifiedForVideoRef } from "@/video-generation/sd2-cert-safety";
import { resolveAssetImageStorageKey } from "@/projects/assets/asset-image-url";

type CharacterMediaSafetySource = Pick<
  CharacterAsset,
  | "id"
  | "mediaVideoRefSafety"
  | "videoRefSafety"
  | "primaryMediaId"
  | "imageFileName"
  | "approvedMediaIds"
  | "lookMediaIds"
  | "historyMediaIds"
>;

function resolvePrimaryMediaId(asset: CharacterMediaSafetySource): string | null {
  const primary = asset.primaryMediaId?.trim();
  if (primary) return primary;
  if (asset.imageFileName?.trim()) {
    return resolveAssetImageStorageKey({
      id: asset.id,
      imageFileName: asset.imageFileName,
      primaryMediaId: asset.primaryMediaId,
      approvedMediaIds: asset.approvedMediaIds,
    });
  }
  return null;
}

export function getCharacterMediaVideoRefSafety(
  asset: CharacterMediaSafetySource,
  mediaId: string,
): VideoRefSafety | null {
  const trimmed = mediaId.trim();
  if (!trimmed) return null;

  const fromMap = asset.mediaVideoRefSafety?.[trimmed];
  if (fromMap) return fromMap;

  // Legacy: only map top-level safety onto the *current* primary media.
  const primary = resolvePrimaryMediaId(asset);
  if (primary && primary === trimmed && asset.videoRefSafety) {
    return asset.videoRefSafety;
  }
  return null;
}

export function isCharacterMediaSd2Certified(
  asset: CharacterMediaSafetySource,
  mediaId: string,
): boolean {
  return isSd2CertifiedForVideoRef(
    getCharacterMediaVideoRefSafety(asset, mediaId),
  );
}

export function setCharacterMediaVideoRefSafety(
  asset: CharacterAsset,
  mediaId: string,
  safety: VideoRefSafety | null,
): CharacterAsset {
  const trimmed = mediaId.trim();
  if (!trimmed) return asset;

  const nextMap: Record<string, VideoRefSafety> = {
    ...(asset.mediaVideoRefSafety ?? {}),
  };
  if (safety == null) {
    delete nextMap[trimmed];
  } else {
    nextMap[trimmed] = safety;
  }

  const primary = resolvePrimaryMediaId(asset);
  let nextTop = asset.videoRefSafety ?? null;
  if (primary && primary === trimmed) {
    nextTop = safety;
  } else if (primary && nextMap[primary]) {
    nextTop = nextMap[primary]!;
  }

  return {
    ...asset,
    mediaVideoRefSafety:
      Object.keys(nextMap).length > 0 ? nextMap : undefined,
    videoRefSafety: nextTop,
  };
}

export function listCertifiedCharacterMediaIds(
  asset: CharacterAsset,
): string[] {
  const ids = new Set<string>();
  const primary = resolvePrimaryMediaId(asset);
  if (primary) ids.add(primary);
  for (const id of asset.approvedMediaIds ?? []) {
    if (id.trim()) ids.add(id.trim());
  }
  for (const id of asset.lookMediaIds ?? []) {
    if (id.trim()) ids.add(id.trim());
  }
  for (const id of asset.historyMediaIds ?? []) {
    if (id.trim()) ids.add(id.trim());
  }
  for (const id of Object.keys(asset.mediaVideoRefSafety ?? {})) {
    if (id.trim()) ids.add(id.trim());
  }

  return [...ids].filter((id) => isCharacterMediaSd2Certified(asset, id));
}

/** Ensure legacy top-level safety is mirrored into the primary media map entry. */
export function migrateCharacterMediaVideoRefSafety(
  asset: CharacterAsset,
): CharacterAsset {
  const primary = resolvePrimaryMediaId(asset);
  if (!primary) return asset;
  if (asset.mediaVideoRefSafety?.[primary]) {
    return {
      ...asset,
      videoRefSafety:
        asset.mediaVideoRefSafety[primary] ?? asset.videoRefSafety ?? null,
    };
  }
  if (asset.videoRefSafety) {
    return setCharacterMediaVideoRefSafety(
      asset,
      primary,
      asset.videoRefSafety,
    );
  }
  return asset;
}
