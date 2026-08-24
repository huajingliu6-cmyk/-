import type { MarketAssetCategory, MarketAssetListQuery } from "@/asset-market/types";
import { isMarketAssetCategory } from "@/asset-market/map-material";
import {
  parseMarketAssetSort,
  parseMarketAssetStatus,
} from "@/asset-market/queries";
import {
  MARKET_ASSET_PAGE_SIZE_DEFAULT,
  MARKET_ASSET_PAGE_SIZE_MAX,
  MARKET_ASSET_PAGE_SIZE_MIN,
} from "@/asset-market/constants";

function parseLimit(raw: string | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return MARKET_ASSET_PAGE_SIZE_DEFAULT;
  return Math.min(
    MARKET_ASSET_PAGE_SIZE_MAX,
    Math.max(MARKET_ASSET_PAGE_SIZE_MIN, Math.floor(value)),
  );
}

export function parseMarketAssetListQuery(
  searchParams: URLSearchParams,
): MarketAssetListQuery {
  const categoryRaw = searchParams.get("category");
  const category = isMarketAssetCategory(categoryRaw) ? categoryRaw : null;
  const tagsRaw = searchParams.get("tags")?.trim();
  return {
    category,
    keyword: searchParams.get("keyword") ?? searchParams.get("q") ?? undefined,
    tags: tagsRaw ? tagsRaw.split(",").map((tag) => tag.trim()).filter(Boolean) : [],
    status: parseMarketAssetStatus(searchParams.get("status")),
    sort: parseMarketAssetSort(searchParams.get("sort")),
    cursor: searchParams.get("cursor"),
    limit: parseLimit(searchParams.get("limit")),
  };
}
