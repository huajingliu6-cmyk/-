import type { ReferenceSelectionMode } from "@/video-generation/reference-media";

export type ReferenceMediaSelectionDraft = {
  draftMode: ReferenceSelectionMode;
  draftSelectedIds: string[];
};

/** 打开 Drawer 时从节点当前值创建一次草稿（不持续 sync） */
export function createReferenceMediaSelectionDraft(params: {
  mode: ReferenceSelectionMode;
  selectedReferenceAssetIds: string[];
}): ReferenceMediaSelectionDraft {
  return {
    draftMode: params.mode === "manual" ? "manual" : "auto",
    draftSelectedIds: [...params.selectedReferenceAssetIds],
  };
}

/**
 * 从自动切到手动：
 * - eligibleCount <= limit：可用当前自动解析结果作初始草稿
 * - eligibleCount > limit：草稿为空，不擅自截前 N
 */
export function switchDraftToManual(params: {
  draft: ReferenceMediaSelectionDraft;
  autoSelectedIds: string[];
  eligibleCount: number;
  limit: number;
}): ReferenceMediaSelectionDraft {
  if (params.eligibleCount > params.limit) {
    return {
      draftMode: "manual",
      draftSelectedIds: [],
    };
  }
  return {
    draftMode: "manual",
    draftSelectedIds: [...params.autoSelectedIds],
  };
}

export function switchDraftToAuto(
  draft: ReferenceMediaSelectionDraft,
): ReferenceMediaSelectionDraft {
  return {
    draftMode: "auto",
    draftSelectedIds: [...draft.draftSelectedIds],
  };
}

export function toggleDraftSelection(params: {
  draft: ReferenceMediaSelectionDraft;
  assetId: string;
  eligible: boolean;
  limit: number;
}): ReferenceMediaSelectionDraft {
  if (params.draft.draftMode !== "manual") return params.draft;
  if (!params.eligible) return params.draft;

  const idx = params.draft.draftSelectedIds.indexOf(params.assetId);
  if (idx >= 0) {
    const next = params.draft.draftSelectedIds.filter(
      (id) => id !== params.assetId,
    );
    return { ...params.draft, draftSelectedIds: next };
  }
  if (params.draft.draftSelectedIds.length >= params.limit) {
    return params.draft;
  }
  return {
    ...params.draft,
    draftSelectedIds: [...params.draft.draftSelectedIds, params.assetId],
  };
}

export function moveDraftSelection(params: {
  draft: ReferenceMediaSelectionDraft;
  assetId: string;
  direction: "up" | "down";
}): ReferenceMediaSelectionDraft {
  const ids = [...params.draft.draftSelectedIds];
  const index = ids.indexOf(params.assetId);
  if (index < 0) return params.draft;
  const swapWith = params.direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= ids.length) return params.draft;
  const tmp = ids[index]!;
  ids[index] = ids[swapWith]!;
  ids[swapWith] = tmp;
  return { ...params.draft, draftSelectedIds: ids };
}

export function removeInvalidDraftIds(params: {
  draft: ReferenceMediaSelectionDraft;
  invalidIds: string[];
}): ReferenceMediaSelectionDraft {
  const ban = new Set(params.invalidIds);
  return {
    ...params.draft,
    draftSelectedIds: params.draft.draftSelectedIds.filter((id) => !ban.has(id)),
  };
}

export function canMoveDraftSelection(
  draft: ReferenceMediaSelectionDraft,
  assetId: string,
  direction: "up" | "down",
): boolean {
  const index = draft.draftSelectedIds.indexOf(assetId);
  if (index < 0) return false;
  if (direction === "up") return index > 0;
  return index < draft.draftSelectedIds.length - 1;
}
