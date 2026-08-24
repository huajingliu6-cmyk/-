import type {
  PersonalAssetCategory,
  PersonalAssetMimeType,
  PersonalAssetSort,
} from "@/personal-assets/types";

export const PERSONAL_ASSETS_NAMESPACE = "personal-assets";

export const PERSONAL_ASSET_QUOTA_BYTES = 1024 * 1024 * 1024;

export const PERSONAL_ASSET_MAX_FILE_BYTES = 20 * 1024 * 1024;

export const PERSONAL_ASSET_LIST_LIMIT = 24;

export const PERSONAL_ASSET_MIME_TYPES: readonly PersonalAssetMimeType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

export const PERSONAL_ASSET_CATEGORY_LABELS: Record<
  PersonalAssetCategory,
  string
> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  other: "其他图片",
};

export const PERSONAL_ASSET_CATEGORY_OPTIONS: Array<{
  id: PersonalAssetCategory | "all";
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "character", label: "角色" },
  { id: "scene", label: "场景" },
  { id: "prop", label: "道具" },
  { id: "other", label: "其他图片" },
];

export const PERSONAL_ASSET_SORT_OPTIONS: Array<{
  id: PersonalAssetSort;
  label: string;
}> = [
  { id: "recent", label: "最近上传" },
  { id: "oldest", label: "最早上传" },
  { id: "name", label: "名称排序" },
];

export const PERSONAL_ASSET_DEFAULT_CATEGORY: PersonalAssetCategory = "other";

export const PERSONAL_ASSET_DRAG_CONFIRM_KEY =
  "personal-assets:drag-upload-confirmed";

export function personalAssetMediaUrl(storageKey: string): string {
  const mediaId = storageKey.replace(/^materials\/blobs\//, "").trim();
  return `/api/materials/media/${encodeURIComponent(mediaId)}`;
}

export function formatPersonalAssetBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
