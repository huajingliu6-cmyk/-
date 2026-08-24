import { isAssetImageStorageKey, resolveAssetImageStorageKey } from "@/projects/assets/asset-image-url";
import type { LibraryVariantDraft, PropAsset, SceneAsset } from "@/projects/assets/types";
import { safeRandomUUID } from "@/lib/safe-random-id";

export type LibraryImageableAsset = SceneAsset | PropAsset;

export type LibraryAssetMediaGridItem = {
  slotId: string;
  mediaId: string | null;
  label: string;
  isEditing?: boolean;
};

export function newLibraryVariantDraftId(): string {
  return `variant_draft_${safeRandomUUID()}`;
}

export function listLibraryVariantDrafts(
  asset: LibraryImageableAsset,
): LibraryVariantDraft[] {
  return asset.variantDrafts ?? [];
}

export function addLibraryVariantDraft<T extends LibraryImageableAsset>(
  asset: T,
  kind: "scene" | "prop",
): { asset: T; draft: LibraryVariantDraft } {
  const drafts = [...(asset.variantDrafts ?? [])];
  const index = drafts.length + 1;
  const draft: LibraryVariantDraft = {
    id: newLibraryVariantDraftId(),
    label: defaultLibraryVariantLabel(asset.name, index, kind),
    promptText: "",
  };
  return {
    asset: { ...asset, variantDrafts: [...drafts, draft] },
    draft,
  };
}

export function updateLibraryVariantDraftPrompt<T extends LibraryImageableAsset>(
  asset: T,
  draftId: string,
  promptText: string,
): T {
  const drafts = asset.variantDrafts ?? [];
  if (!drafts.some((item) => item.id === draftId)) return asset;
  return {
    ...asset,
    variantDrafts: drafts.map((item) =>
      item.id === draftId ? { ...item, promptText } : item,
    ),
  };
}

export function updateLibraryVariantDraftLabel<T extends LibraryImageableAsset>(
  asset: T,
  draftId: string,
  label: string,
): T {
  const trimmed = label.trim();
  if (!trimmed) return asset;
  const drafts = asset.variantDrafts ?? [];
  if (!drafts.some((item) => item.id === draftId)) return asset;
  return {
    ...asset,
    variantDrafts: drafts.map((item) =>
      item.id === draftId ? { ...item, label: trimmed } : item,
    ),
  };
}

export function removeLibraryVariantDraft<T extends LibraryImageableAsset>(
  asset: T,
  draftId: string,
): T {
  const drafts = (asset.variantDrafts ?? []).filter((item) => item.id !== draftId);
  if (drafts.length === (asset.variantDrafts ?? []).length) return asset;
  const next = { ...asset };
  if (drafts.length > 0) {
    next.variantDrafts = drafts;
  } else {
    delete next.variantDrafts;
  }
  return next;
}

export function findLibraryVariantDraft(
  asset: LibraryImageableAsset,
  draftId: string | null | undefined,
): LibraryVariantDraft | null {
  if (!draftId) return null;
  return (asset.variantDrafts ?? []).find((item) => item.id === draftId) ?? null;
}

export function buildLibraryVariantGridItems(
  asset: LibraryImageableAsset,
  variantMediaIds: string[],
  kind: "scene" | "prop",
): LibraryAssetMediaGridItem[] {
  const mediaItems = variantMediaIds.map((mediaId, index) => ({
    slotId: mediaId,
    mediaId,
    label: resolveLibraryVariantLabel(asset, mediaId, index + 1, kind),
    isEditing: false,
  }));
  const draftItems = (asset.variantDrafts ?? []).map((draft) => ({
    slotId: draft.id,
    mediaId: null,
    label: draft.label,
    isEditing: true,
  }));
  return [...mediaItems, ...draftItems];
}

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
  slotId: string,
): T {
  const drafts = asset.variantDrafts ?? [];
  if (drafts.some((item) => item.id === slotId)) {
    return removeLibraryVariantDraft(asset, slotId);
  }
  const mediaId = slotId;
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
