import type { MarketAssetCategory } from "@/asset-market/types";
import { APP_ASSET_MARKET_PATH } from "@/shell/nav";

export { APP_ASSET_MARKET_PATH };

export const MARKET_ASSET_CATEGORIES: MarketAssetCategory[] = [
  "character",
  "clothing",
  "scene",
  "prop",
];

export const MARKET_CATEGORY_LABELS: Record<MarketAssetCategory, string> = {
  character: "角色形象",
  clothing: "衣服商城",
  scene: "常用场景",
  prop: "常用道具",
};

export const MARKET_ASSET_PAGE_SIZE_DEFAULT = 32;
export const MARKET_ASSET_PAGE_SIZE_MIN = 24;
export const MARKET_ASSET_PAGE_SIZE_MAX = 40;

export const MARKET_ASSET_MAX_BYTES = 10 * 1024 * 1024;

export const MARKET_ADDITIONS_NAMESPACE = "asset-market-additions";
export const MARKET_AUDIT_NAMESPACE = "asset-market-audit";

export function marketAssetThumbnailUrl(assetId: string): string {
  return `/api/asset-market/${encodeURIComponent(assetId)}/thumbnail`;
}

export function marketAssetPreviewUrl(assetId: string): string {
  return `/api/asset-market/${encodeURIComponent(assetId)}/preview`;
}

export function marketAssetDownloadUrl(assetId: string): string {
  return `/api/asset-market/${encodeURIComponent(assetId)}/download`;
}
