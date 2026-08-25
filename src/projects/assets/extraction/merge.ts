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

/**
 * Supplement merge: keep prior assets, append newly completed selected assets,
 * never drop unrelated library entries from a partial re-extract.
 */
export function mergeSupplementAssets(input: {
  activeAssets: ExtractedAsset[];
  selectedExtractedAssets: ExtractedAsset[];
}): ExtractedAsset[] {
  const selectedIdentities = new Set(
    input.selectedExtractedAssets.map((asset) => asset.identity),
  );
  const preserved = input.activeAssets.filter(
    (asset) => !selectedIdentities.has(asset.identity),
  );
  const additions: ExtractedAsset[] = [];
  for (const selected of input.selectedExtractedAssets) {
    const prior = input.activeAssets.find(
      (asset) => asset.identity === selected.identity,
    );
    if (prior) {
      additions.push({
        ...prior,
        sourceEpisodeIds: [
          ...new Set([...prior.sourceEpisodeIds, ...selected.sourceEpisodeIds]),
        ],
        libraryAssetId: prior.libraryAssetId ?? selected.libraryAssetId,
        firstSeenOrder: Math.min(
          prior.firstSeenOrder ?? Number.MAX_SAFE_INTEGER,
          selected.firstSeenOrder ?? Number.MAX_SAFE_INTEGER,
        ),
      });
      continue;
    }
    additions.push(selected);
  }
  return mergeExtractedAssets([preserved, additions]);
}
