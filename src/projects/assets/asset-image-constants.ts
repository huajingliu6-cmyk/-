/** Shared limits — safe for client and server bundles. */

export const PROJECT_ASSET_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const PROJECT_ASSET_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type ProjectAssetImageMime = (typeof PROJECT_ASSET_IMAGE_MIME)[number];
