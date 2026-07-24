/**
 * HTTP 请求体中 selectedReferenceAssetIds 的通用安全上限。
 * 仅防止超大 Payload，**不是**模型能力上限（见 ModelCapability.maxReferenceMedia）。
 */
export const MAX_REFERENCE_SELECTION_IDS_IN_REQUEST = 64;

export const ALLOWED_REFERENCE_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const ALLOWED_REFERENCE_VIDEO_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
