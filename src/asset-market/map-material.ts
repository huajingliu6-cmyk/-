import {
  marketAssetPreviewUrl,
  marketAssetThumbnailUrl,
} from "@/asset-market/constants";
import type {
  MarketAsset,
  MarketAssetCategory,
  MarketAssetStatus,
} from "@/asset-market/types";
import type { Material } from "@/materials/types";

const MARKET_CATEGORIES = new Set<MarketAssetCategory>([
  "character",
  "clothing",
  "scene",
  "prop",
]);

export function isMarketAssetCategory(
  value: unknown,
): value is MarketAssetCategory {
  return (
    typeof value === "string" &&
    MARKET_CATEGORIES.has(value as MarketAssetCategory)
  );
}

export function materialToMarketStatus(material: Material): MarketAssetStatus {
  if (material.status === "deleted") return "unpublished";
  return "published";
}

export function materialToMarketAsset(
  material: Material,
  options?: {
    addedToPersonal?: boolean;
    mimeType?: MarketAsset["mimeType"];
    fileSize?: number;
    width?: number;
    height?: number;
    statusOverride?: MarketAssetStatus;
  },
): MarketAsset | null {
  if (!isMarketAssetCategory(material.type)) return null;
  const status = options?.statusOverride ?? materialToMarketStatus(material);
  return {
    id: material.id,
    category: material.type,
    name: material.name,
    description: material.description,
    tags: [...material.tags, ...material.themeTags],
    mimeType: options?.mimeType ?? "",
    fileSize: options?.fileSize ?? 0,
    width: options?.width ?? 0,
    height: options?.height ?? 0,
    status,
    downloadAllowed: true,
    usageCount: material.citeCount,
    createdBy: material.createdBy,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
    publishedAt: material.status === "active" ? material.createdAt : null,
    thumbnailUrl: marketAssetThumbnailUrl(material.id),
    previewUrl: marketAssetPreviewUrl(material.id),
    addedToPersonal: options?.addedToPersonal,
  };
}
