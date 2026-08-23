/**
 * Client-safe project asset image URL helpers (no Node fs).
 */

/** Same rules as server `isSafeProjectAssetImageId` — media keys on disk. */
const SAFE_STORAGE_KEY_RE = /^[A-Za-z0-9_-]+$/;

export type AssetImageApiContext = "management" | "workspace";

export function isAssetImageStorageKey(id: string): boolean {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 128 &&
    SAFE_STORAGE_KEY_RE.test(id) &&
    !id.includes("..") &&
    !id.includes("/") &&
    !id.includes("\\") &&
    !id.includes("\0")
  );
}

/**
 * Disk / GET key for an asset image.
 * Uploads store bytes under `asset.id` while `imageFileName` is a display name
 * (e.g. hero.png). Approval promote stores bytes under `gen_*` and puts that
 * id into `imageFileName` / `primaryMediaId`.
 */
export function resolveAssetImageStorageKey(asset: {
  id: string;
  imageFileName?: string | null;
  primaryMediaId?: string | null;
  approvedMediaIds?: readonly string[] | null;
}): string {
  const primary = asset.primaryMediaId?.trim();
  if (primary && isAssetImageStorageKey(primary)) return primary;
  const fileName = asset.imageFileName?.trim();
  if (fileName && isAssetImageStorageKey(fileName)) return fileName;
  const approved = (asset.approvedMediaIds ?? []).find((id) =>
    isAssetImageStorageKey(id.trim()),
  );
  if (approved) return approved.trim();
  return asset.id;
}

function assetsDraftImagesBase(
  projectId: string,
  assetOrMediaId: string,
  context: AssetImageApiContext = "management",
): string {
  const encodedProject = encodeURIComponent(projectId);
  const encodedAsset = encodeURIComponent(assetOrMediaId);
  return context === "workspace"
    ? `/api/workspace/projects/${encodedProject}/assets-draft/images/${encodedAsset}`
    : `/api/projects/${encodedProject}/assets-draft/images/${encodedAsset}`;
}

export function getProjectAssetImageUrl(
  projectId: string,
  assetOrMediaId: string,
  options?: {
    revision?: string | number | null;
    context?: AssetImageApiContext;
  },
): string {
  const base = assetsDraftImagesBase(
    projectId,
    assetOrMediaId,
    options?.context ?? "management",
  );
  if (
    options?.revision !== undefined &&
    options.revision !== null &&
    options.revision !== ""
  ) {
    return `${base}?v=${encodeURIComponent(String(options.revision))}`;
  }
  return base;
}

export type AssetImageSrcFields = {
  id: string;
  imageFileName: string | null;
  imageObjectUrl: string | null;
  primaryMediaId?: string | null;
  approvedMediaIds?: readonly string[] | null;
};

/**
 * Prefer temporary blob preview while uploading; otherwise derive the
 * durable GET URL from the on-disk media key. Never treat a stale blob:
 * string as recoverable after reload.
 */
export function resolveAssetImageSrc(
  projectId: string,
  asset: AssetImageSrcFields,
  options?: {
    revision?: string | number | null;
    context?: AssetImageApiContext;
  },
): string | null {
  const objectUrl = asset.imageObjectUrl;
  if (objectUrl && objectUrl.startsWith("blob:")) {
    return objectUrl;
  }
  if (
    asset.imageFileName ||
    asset.primaryMediaId ||
    (asset.approvedMediaIds && asset.approvedMediaIds.length > 0)
  ) {
    return getProjectAssetImageUrl(
      projectId,
      resolveAssetImageStorageKey(asset),
      options,
    );
  }
  return null;
}
