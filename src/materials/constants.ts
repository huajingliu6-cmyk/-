import type { MaterialGenderTag, MaterialType } from "@/materials/types";

export const MATERIAL_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const MATERIAL_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type MaterialImageMime = (typeof MATERIAL_IMAGE_MIMES)[number];

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  character: "人物形象",
  clothing: "衣服",
  prop: "道具",
  scene: "场景",
};

export const MATERIAL_TYPES: MaterialType[] = [
  "character",
  "clothing",
  "prop",
  "scene",
];

export const MATERIAL_GENDER_OPTIONS: Array<{
  id: MaterialGenderTag;
  label: string;
}> = [
  { id: "male", label: "男装" },
  { id: "female", label: "女装" },
  { id: "child", label: "童装" },
  { id: "unrestricted", label: "不限" },
];

export const MATERIAL_THEME_OPTIONS = [
  { id: "ancient", label: "古装" },
  { id: "modern", label: "现代" },
  { id: "workplace", label: "职场" },
  { id: "campus", label: "校园" },
  { id: "formal", label: "礼服" },
  { id: "sport", label: "运动" },
  { id: "ethnic", label: "民族" },
  { id: "fantasy", label: "奇幻" },
  { id: "unrestricted", label: "不限" },
] as const;

export const MATERIAL_CATALOG_NAMESPACE = "material-catalog";
export const MATERIAL_CATALOG_KEY = "catalog";
export const MATERIAL_CITATIONS_NAMESPACE = "material-citations";
export const MATERIAL_BLOB_PREFIX = "materials";

export function materialMediaUrl(mediaId: string): string {
  return `/api/materials/media/${encodeURIComponent(mediaId)}`;
}
