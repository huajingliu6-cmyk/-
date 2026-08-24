import {
  MARKET_ASSET_CATEGORIES,
  MARKET_ASSET_PAGE_SIZE_DEFAULT,
  MARKET_ASSET_PAGE_SIZE_MAX,
  MARKET_ASSET_PAGE_SIZE_MIN,
} from "@/asset-market/constants";
import {
  isMarketAssetCategory,
  materialToMarketAsset,
} from "@/asset-market/map-material";
import type {
  MarketAsset,
  MarketAssetCategory,
  MarketAssetListQuery,
  MarketAssetListResult,
  MarketAssetSort,
  MarketAssetStatus,
} from "@/asset-market/types";
import type { Material } from "@/materials/types";

function normalizeKeyword(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function parseLimit(value: number | undefined): number {
  const raw = value ?? MARKET_ASSET_PAGE_SIZE_DEFAULT;
  return Math.min(
    MARKET_ASSET_PAGE_SIZE_MAX,
    Math.max(MARKET_ASSET_PAGE_SIZE_MIN, Math.floor(raw)),
  );
}

function sortMaterialsForMarket(
  materials: Material[],
  sort: MarketAssetSort,
): Material[] {
  const copy = [...materials];
  if (sort === "updated") {
    copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return copy;
  }
  if (sort === "usage") {
    copy.sort((a, b) => {
      if (b.citeCount !== a.citeCount) return b.citeCount - a.citeCount;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return copy;
  }
  copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return copy;
}

function materialMatchesMarketQuery(
  material: Material,
  query: MarketAssetListQuery,
  options?: { includeUnpublished?: boolean },
): boolean {
  if (!isMarketAssetCategory(material.type)) return false;

  const status = material.status === "deleted" ? "unpublished" : "published";
  if (!options?.includeUnpublished && status !== "published") return false;
  if (query.status && query.status !== "all" && query.status !== status) {
    return false;
  }
  if (query.category && material.type !== query.category) return false;

  const tags = query.tags?.filter(Boolean) ?? [];
  if (tags.length > 0) {
    const haystack = new Set([
      ...material.tags,
      ...material.themeTags,
      ...material.genderTags,
    ]);
    if (!tags.some((tag) => haystack.has(tag))) return false;
  }

  const keyword = normalizeKeyword(query.keyword);
  if (keyword) {
    const haystack = [
      material.name,
      material.description,
      ...material.tags,
      ...material.themeTags,
      ...material.genderTags,
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(keyword)) return false;
  }

  return true;
}

export function queryMarketAssets(input: {
  materials: Material[];
  query: MarketAssetListQuery;
  addedIds?: Set<string>;
  includeUnpublished?: boolean;
}): MarketAssetListResult {
  const sort = input.query.sort ?? "latest";
  const limit = parseLimit(input.query.limit);
  const filtered = sortMaterialsForMarket(
    input.materials.filter((material) =>
      materialMatchesMarketQuery(material, input.query, {
        includeUnpublished: input.includeUnpublished,
      }),
    ),
    sort,
  );

  const categoryCounts = Object.fromEntries(
    MARKET_ASSET_CATEGORIES.map((category) => [
      category,
      input.materials.filter((material) => {
        if (!isMarketAssetCategory(material.type) || material.type !== category) {
          return false;
        }
        return materialMatchesMarketQuery(
          material,
          { ...input.query, category },
          { includeUnpublished: input.includeUnpublished },
        );
      }).length,
    ]),
  ) as Record<MarketAssetCategory, number>;

  let startIndex = 0;
  const cursor = input.query.cursor?.trim();
  if (cursor) {
    const index = filtered.findIndex((item) => item.id === cursor);
    if (index >= 0) startIndex = index + 1;
  }

  const page = filtered.slice(startIndex, startIndex + limit);
  const nextCursor =
    startIndex + limit < filtered.length
      ? page[page.length - 1]?.id ?? null
      : null;

  const items = page
    .map((material) =>
      materialToMarketAsset(material, {
        addedToPersonal: input.addedIds?.has(material.id),
      }),
    )
    .filter((item): item is MarketAsset => item != null);

  return {
    items,
    nextCursor,
    total: filtered.length,
    categoryCounts,
  };
}

export function parseMarketAssetSort(value: unknown): MarketAssetSort {
  if (value === "updated" || value === "usage" || value === "latest") {
    return value;
  }
  return "latest";
}

export function parseMarketAssetStatus(
  value: unknown,
): MarketAssetStatus | "all" | null {
  if (value === "all") return "all";
  if (
    value === "processing" ||
    value === "published" ||
    value === "unpublished" ||
    value === "failed"
  ) {
    return value;
  }
  return null;
}
