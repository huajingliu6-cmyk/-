import { isAssetImageStorageKey, resolveAssetImageStorageKey } from "@/projects/assets/asset-image-url";
import type { PropAsset, SceneAsset } from "@/projects/assets/types";

export type LibraryImageableAsset = SceneAsset | PropAsset;

export function resolveLibraryAssetPrimaryMediaId(
  asset: LibraryImageableAsset,
): string | null {
  const hasImage =
    Boolean(asset.primaryMediaId?.trim()) ||
    Boolean(asset.imageFileName?.trim()) ||
    (asset.approvedMediaIds ?? []).some((id) => id?.trim());
  if (!hasImage) return null;
  const key = resolveAssetImageStorageKey(asset);
  return isAssetImageStorageKey(key) ? key : null;
}

export function collectLibraryAssetVariantMediaIds(
  asset: LibraryImageableAsset,
  extraMediaIds: string[] = [],
): { primaryMediaId: string | null; variantMediaIds: string[] } {
  const primary = resolveLibraryAssetPrimaryMediaId(asset);
  const merged = [...(asset.approvedMediaIds ?? []), ...extraMediaIds]
    .map((id) => id.trim())
    .filter((id) => id && isAssetImageStorageKey(id));
  const unique = merged.filter((id, index) => merged.indexOf(id) === index);
  const variantMediaIds = unique.filter((id) => id !== primary);
  return { primaryMediaId: primary, variantMediaIds };
}

export function defaultLibraryVariantLabel(
  assetName: string,
  index: number,
  kind: "scene" | "prop",
): string {
  const base = assetName.trim() || (kind === "scene" ? "未命名场景" : "未命名道具");
  return kind === "scene"
    ? `${base}·场景版本 ${index}`
    : `${base}·道具版本 ${index}`;
}

export function resolveLibraryVariantLabel(
  asset: LibraryImageableAsset,
  mediaId: string,
  index: number,
  kind: "scene" | "prop",
): string {
  const custom = asset.mediaVariantLabels?.[mediaId]?.trim();
  if (custom) return custom;
  return defaultLibraryVariantLabel(asset.name, index, kind);
}

export function withLibraryVariantLabel<T extends LibraryImageableAsset>(
  asset: T,
  mediaId: string,
  label: string,
  kind: "scene" | "prop",
  index: number,
): T {
  const trimmed = label.trim();
  const defaultLabel = defaultLibraryVariantLabel(asset.name, index, kind);
  const previous = asset.mediaVariantLabels ?? {};
  if (!trimmed || trimmed === defaultLabel) {
    const { [mediaId]: _removed, ...rest } = previous;
    return {
      ...asset,
      ...(Object.keys(rest).length > 0 ? { mediaVariantLabels: rest } : {}),
    };
  }
  return {
    ...asset,
    mediaVariantLabels: { ...previous, [mediaId]: trimmed },
  };
}

export function withoutLibraryVariantMedia<T extends LibraryImageableAsset>(
  asset: T,
  mediaId: string,
): T {
  const primary = resolveLibraryAssetPrimaryMediaId(asset);
  const labels = { ...(asset.mediaVariantLabels ?? {}) };
  delete labels[mediaId];
  return {
    ...asset,
    approvedMediaIds: (asset.approvedMediaIds ?? []).filter((id) => id !== mediaId),
    ...(primary === mediaId
      ? {
          primaryMediaId: null,
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
        }
      : {}),
    ...(Object.keys(labels).length > 0 ? { mediaVariantLabels: labels } : {}),
  };
}
