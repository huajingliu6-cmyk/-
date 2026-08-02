/**
 * Client-safe project asset audio URL helpers (no Node fs).
 */

export function getProjectAssetAudioUrl(
  projectId: string,
  assetId: string,
  options?: { revision?: string | number | null },
): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/assets-draft/audio/${encodeURIComponent(assetId)}`;
  if (
    options?.revision !== undefined &&
    options.revision !== null &&
    options.revision !== ""
  ) {
    return `${base}?v=${encodeURIComponent(String(options.revision))}`;
  }
  return base;
}

export type AssetAudioSrcFields = {
  id: string;
  fileName: string | null;
  objectUrl: string | null;
};

/**
 * Prefer temporary blob preview while uploading; otherwise derive the
 * durable GET URL from fileName + assetId. Never treat a stale blob:
 * string as recoverable after reload.
 */
export function resolveAssetAudioSrc(
  projectId: string,
  asset: AssetAudioSrcFields,
  options?: { revision?: string | number | null },
): string | null {
  const objectUrl = asset.objectUrl;
  if (objectUrl && objectUrl.startsWith("blob:")) {
    return objectUrl;
  }
  if (asset.fileName) {
    return getProjectAssetAudioUrl(projectId, asset.id, options);
  }
  return null;
}
