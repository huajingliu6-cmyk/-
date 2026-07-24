import type {
  FirstFrameResolution,
  ReferenceMediaCandidate,
  ReferenceSelectionMode,
  ResolvedReferenceMediaSelection,
  StructuredGenerationError,
} from "@/video-generation/reference-media";
import type { ModelCapability } from "@/video-generation/types";

export type ReferenceMediaGroupKey =
  | "character"
  | "scene"
  | "general"
  | "referenceVideo";

export type ReferenceMediaGroup = {
  key: ReferenceMediaGroupKey;
  title: string;
  items: ReferenceMediaCandidate[];
};

export type ExcludedReferenceItem = {
  candidate: ReferenceMediaCandidate;
  reason: string;
};

export type InvalidSelectionItem = {
  assetId: string;
  reason: string;
};

export type ReferenceMediaSelectionView = {
  capabilityLoaded: boolean;
  limit: number | null;
  maxFirstFrames: number | null;
  candidateCount: number;
  eligibleCount: number;
  selectedCount: number;
  requiresManualSelection: boolean;
  hasInvalidSelection: boolean;
  groups: ReferenceMediaGroup[];
  selectedOrdered: ReferenceMediaCandidate[];
  excluded: ExcludedReferenceItem[];
  invalidSelections: InvalidSelectionItem[];
  firstFrame: ReferenceMediaCandidate | null;
  firstFrameErrors: StructuredGenerationError[];
  summaryMessage: string;
  nodeSummaryLabel: string;
  canGenerate: boolean;
  canSaveSelection: boolean;
  blockingErrors: string[];
  mode: ReferenceSelectionMode;
};

const GROUP_ORDER: Array<{ key: ReferenceMediaGroupKey; title: string }> = [
  { key: "character", title: "角色" },
  { key: "scene", title: "场景" },
  { key: "general", title: "普通图片" },
  { key: "referenceVideo", title: "参考视频" },
];

function exclusionReason(candidate: ReferenceMediaCandidate): string {
  if (!candidate.eligible) {
    return candidate.disabledReason || "当前不可用";
  }
  return "用户未选择";
}

export type BuildReferenceMediaSelectionViewArgs = {
  candidates: ReferenceMediaCandidate[];
  resolvedSelection: ResolvedReferenceMediaSelection | null;
  firstFrame: FirstFrameResolution;
  capability: Pick<
    ModelCapability,
    "maxReferenceMedia" | "maxFirstFrames"
  > | null;
  currentMode: ReferenceSelectionMode;
};

/**
 * UI 派生视图：不持久化，不修改输入数组。
 */
export function buildReferenceMediaSelectionView(
  args: BuildReferenceMediaSelectionViewArgs,
): ReferenceMediaSelectionView {
  const { candidates, resolvedSelection, firstFrame, capability, currentMode } =
    args;
  const capabilityLoaded = capability != null;
  const limit = capability?.maxReferenceMedia ?? null;
  const maxFirstFrames = capability?.maxFirstFrames ?? null;

  const eligible = candidates.filter((c) => c.eligible);
  const groups: ReferenceMediaGroup[] = GROUP_ORDER.map((g) => ({
    key: g.key,
    title: g.title,
    items: candidates.filter((c) => c.referenceKind === g.key),
  })).filter((g) => g.items.length > 0);

  const firstFrameCandidate =
    firstFrame.ok ? firstFrame.firstFrame : null;
  const firstFrameErrors = firstFrame.ok ? [] : firstFrame.errors;

  if (!capabilityLoaded || !resolvedSelection) {
    const blocking = ["模型能力尚未加载，暂时无法确认参考素材上限。"];
    for (const e of firstFrameErrors) blocking.push(e.message);
    return {
      capabilityLoaded: false,
      limit: null,
      maxFirstFrames: null,
      candidateCount: candidates.length,
      eligibleCount: eligible.length,
      selectedCount: 0,
      requiresManualSelection: false,
      hasInvalidSelection: false,
      groups,
      selectedOrdered: [],
      excluded: candidates.map((c) => ({
        candidate: c,
        reason: exclusionReason(c),
      })),
      invalidSelections: [],
      firstFrame: firstFrameCandidate,
      firstFrameErrors,
      summaryMessage: "模型能力尚未加载",
      nodeSummaryLabel: "模型能力未加载",
      canGenerate: false,
      canSaveSelection: false,
      blockingErrors: blocking,
      mode: currentMode,
    };
  }

  const selectedOrdered = resolvedSelection.selected.slice();
  const selectedIds = new Set(selectedOrdered.map((c) => c.assetId));
  const excluded: ExcludedReferenceItem[] = candidates
    .filter((c) => !selectedIds.has(c.assetId))
    .map((c) => ({ candidate: c, reason: exclusionReason(c) }));

  const invalidSelections: InvalidSelectionItem[] = [];
  for (const id of resolvedSelection.invalidSelectedIds) {
    const hit = candidates.find((c) => c.assetId === id);
    invalidSelections.push({
      assetId: id,
      reason: hit?.disabledReason || "选择已失效或不在候选池中",
    });
  }
  for (const id of resolvedSelection.duplicateSelectedIds) {
    if (!invalidSelections.some((i) => i.assetId === id)) {
      invalidSelections.push({ assetId: id, reason: "重复选择" });
    }
  }

  const blockingErrors: string[] = [];
  for (const e of firstFrameErrors) blockingErrors.push(e.message);
  for (const e of resolvedSelection.validationErrors) {
    blockingErrors.push(e.message);
  }
  if (resolvedSelection.requiresManualSelection) {
    // already in validationErrors typically
    if (
      !blockingErrors.some((m) =>
        m.includes("请先手动选择"),
      )
    ) {
      blockingErrors.push(
        `当前有 ${eligible.length} 项合法参考素材，模型最多支持 ${limit} 项，请切换为手动选择。`,
      );
    }
  }

  const hasInvalidSelection =
    invalidSelections.length > 0 ||
    resolvedSelection.validationErrors.length > 0;

  const canGenerate =
    capabilityLoaded &&
    !resolvedSelection.requiresManualSelection &&
    resolvedSelection.validationErrors.length === 0 &&
    firstFrameErrors.length === 0;

  const canSaveSelection =
    capabilityLoaded &&
    !resolvedSelection.requiresManualSelection &&
    (currentMode === "auto" ||
      resolvedSelection.validationErrors.length === 0);

  let summaryMessage = "";
  let nodeSummaryLabel = "";
  if (resolvedSelection.requiresManualSelection) {
    summaryMessage = `当前有 ${eligible.length} 项合法参考素材，模型最多支持 ${limit} 项，请切换为手动选择。`;
    nodeSummaryLabel = `${eligible.length} 项候选，需要手动选择`;
  } else if (currentMode === "auto") {
    summaryMessage = `已自动选择全部 ${eligible.length} 项合法参考素材。`;
    nodeSummaryLabel =
      eligible.length === 0
        ? "无参考素材"
        : `已自动使用全部 ${eligible.length} 项`;
  } else if (hasInvalidSelection) {
    summaryMessage = blockingErrors[0] || "参考素材选择无效";
    nodeSummaryLabel = `选择中存在 ${invalidSelections.length || 1} 项失效素材`;
  } else {
    summaryMessage = `手动选择 ${selectedOrdered.length} / ${limit}`;
    nodeSummaryLabel = `手动选择 ${selectedOrdered.length} / ${limit}`;
  }

  if (firstFrameCandidate) {
    nodeSummaryLabel = `${nodeSummaryLabel} · 首帧已连接`;
  }

  return {
    capabilityLoaded: true,
    limit,
    maxFirstFrames,
    candidateCount: candidates.length,
    eligibleCount: eligible.length,
    selectedCount: selectedOrdered.length,
    requiresManualSelection: resolvedSelection.requiresManualSelection,
    hasInvalidSelection,
    groups,
    selectedOrdered,
    excluded,
    invalidSelections,
    firstFrame: firstFrameCandidate,
    firstFrameErrors,
    summaryMessage,
    nodeSummaryLabel,
    canGenerate,
    canSaveSelection,
    blockingErrors,
    mode: currentMode,
  };
}

/** 草稿态：在 resolve 之前判断能否保存（上限等） */
export function canSaveReferenceMediaDraft(params: {
  capabilityLoaded: boolean;
  mode: ReferenceSelectionMode;
  eligibleCount: number;
  limit: number | null;
  draftSelectedIds: string[];
  invalidDraftIds: string[];
  resolvedErrors: StructuredGenerationError[];
  requiresManualSelection: boolean;
}): boolean {
  if (!params.capabilityLoaded || params.limit == null) return false;
  if (params.mode === "auto") {
    return !params.requiresManualSelection && params.eligibleCount <= params.limit;
  }
  if (params.invalidDraftIds.length > 0) return false;
  if (params.draftSelectedIds.length > params.limit) return false;
  if (params.resolvedErrors.some((e) => e.code === "REFERENCE_MEDIA_LIMIT_EXCEEDED")) {
    return false;
  }
  if (params.resolvedErrors.some((e) => e.code === "INVALID_REFERENCE_SELECTION")) {
    return false;
  }
  if (params.resolvedErrors.some((e) => e.code === "REFERENCE_MEDIA_NOT_AVAILABLE")) {
    return false;
  }
  return true;
}
