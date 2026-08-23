import type { ExtractedAsset } from "@/projects/assets/extraction/types";

export function mergeExtractedAssets(
  groups: ExtractedAsset[][],
): ExtractedAsset[] {
  const byIdentity = new Map<string, ExtractedAsset>();
  for (const group of groups) {
    for (const asset of group) {
      const existing = byIdentity.get(asset.identity);
      if (!existing) {
        byIdentity.set(asset.identity, {
          ...asset,
          sourceEpisodeIds: [...new Set(asset.sourceEpisodeIds)],
        });
        continue;
      }
      byIdentity.set(asset.identity, {
        ...existing,
        ...asset,
        libraryAssetId: asset.libraryAssetId ?? existing.libraryAssetId,
        firstSeenOrder: Math.min(
          existing.firstSeenOrder ?? Number.MAX_SAFE_INTEGER,
          asset.firstSeenOrder ?? Number.MAX_SAFE_INTEGER,
        ),
        sourceEpisodeIds: [
          ...new Set([...existing.sourceEpisodeIds, ...asset.sourceEpisodeIds]),
        ],
      });
    }
  }
  return [...byIdentity.values()].sort(
    (a, b) =>
      (a.firstSeenOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.firstSeenOrder ?? Number.MAX_SAFE_INTEGER),
  );
}
