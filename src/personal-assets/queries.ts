import type {
  PersonalAsset,
  PersonalAssetCategory,
  PersonalAssetListQuery,
  PersonalAssetListResult,
  PersonalAssetSort,
  PersonalAssetStore,
} from "@/personal-assets/types";
import {
  PERSONAL_ASSET_LIST_LIMIT,
  PERSONAL_ASSET_QUOTA_BYTES,
} from "@/personal-assets/constants";

function compareAssets(a: PersonalAsset, b: PersonalAsset, sort: PersonalAssetSort) {
  if (sort === "name") {
    return a.name.localeCompare(b.name, "zh-CN");
  }
  const aTime = Date.parse(a.createdAt);
  const bTime = Date.parse(b.createdAt);
  if (sort === "oldest") return aTime - bTime;
  return bTime - aTime;
}

function countByCategory(
  assets: PersonalAsset[],
): Record<PersonalAssetCategory, number> {
  return assets.reduce(
    (counts, asset) => {
      counts[asset.category] += 1;
      return counts;
    },
    {
      character: 0,
      scene: 0,
      prop: 0,
      other: 0,
    } satisfies Record<PersonalAssetCategory, number>,
  );
}

export function sumPersonalAssetBytes(assets: PersonalAsset[]): number {
  return assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
}

export function queryPersonalAssets(
  assets: PersonalAsset[],
  query: PersonalAssetListQuery,
): PersonalAssetListResult {
  const categoryCounts = countByCategory(assets);
  const usedBytes = sumPersonalAssetBytes(assets);
  const sort = query.sort ?? "recent";
  const limit = Math.max(
    1,
    Math.min(PERSONAL_ASSET_LIST_LIMIT, Math.floor(query.limit ?? PERSONAL_ASSET_LIST_LIMIT)),
  );
  const search = (query.search ?? "").trim().toLowerCase();

  let filtered = [...assets];
  if (query.category && query.category !== "all") {
    filtered = filtered.filter((asset) => asset.category === query.category);
  }
  if (search) {
    filtered = filtered.filter((asset) =>
      asset.name.toLowerCase().includes(search),
    );
  }

  filtered.sort((a, b) => compareAssets(a, b, sort));

  let startIndex = 0;
  if (query.cursor) {
    const cursorIndex = filtered.findIndex((asset) => asset.id === query.cursor);
    if (cursorIndex >= 0) startIndex = cursorIndex + 1;
  }

  const items = filtered.slice(startIndex, startIndex + limit);
  const nextCursor =
    startIndex + limit < filtered.length
      ? (items[items.length - 1]?.id ?? null)
      : null;

  return {
    items,
    nextCursor,
    total: filtered.length,
    categoryCounts,
    usedBytes,
    quotaBytes: PERSONAL_ASSET_QUOTA_BYTES,
  };
}
