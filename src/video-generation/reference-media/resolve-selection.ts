import type { ModelCapability } from "../types";
import {
  firstFrameInSelectionError,
  invalidReferenceSelectionError,
  referenceMediaLimitExceededError,
  referenceMediaNotAvailableError,
  referenceSelectionRequiredError,
} from "./errors";
import type {
  ReferenceMediaCandidate,
  ReferenceSelectionMode,
  ResolvedReferenceMediaSelection,
  StructuredGenerationError,
} from "./types";

export type ResolveReferenceMediaSelectionArgs = {
  candidates: ReferenceMediaCandidate[];
  selectionMode: ReferenceSelectionMode;
  selectedReferenceAssetIds: string[];
  capability: Pick<ModelCapability, "maxReferenceMedia">;
  /** 首帧 assetId（若有）；不得出现在普通选择中 */
  firstFrameAssetId?: string | null;
};

/**
 * 解析自动/手动参考素材选择。纯函数：不修改输入数组。
 */
export function resolveReferenceMediaSelection(
  args: ResolveReferenceMediaSelectionArgs,
): ResolvedReferenceMediaSelection {
  const limit = args.capability.maxReferenceMedia;
  const mode = args.selectionMode;
  const candidates = args.candidates.slice();
  const selectedIdsInput = args.selectedReferenceAssetIds.slice();
  const eligible = candidates.filter((c) => c.eligible);
  const byId = new Map(candidates.map((c) => [c.assetId, c]));

  if (mode === "auto") {
    if (eligible.length > limit) {
      return {
        mode,
        limit,
        selected: [],
        excluded: eligible.slice(),
        invalidSelectedIds: [],
        duplicateSelectedIds: [],
        requiresManualSelection: true,
        validationErrors: [
          referenceSelectionRequiredError(eligible.length, limit),
        ],
      };
    }
    const selected = eligible.slice();
    const selectedSet = new Set(selected.map((c) => c.assetId));
    return {
      mode,
      limit,
      selected,
      excluded: candidates.filter((c) => !selectedSet.has(c.assetId)),
      invalidSelectedIds: [],
      duplicateSelectedIds: [],
      requiresManualSelection: false,
      validationErrors: [],
    };
  }

  // —— manual：空数组表示明确选择零项，绝不回退为 auto ——
  const errors: StructuredGenerationError[] = [];
  const duplicateSelectedIds: string[] = [];
  const invalidSelectedIds: string[] = [];
  const unavailableIds: string[] = [];
  let firstFrameConflict = false;

  const seen = new Set<string>();
  for (const id of selectedIdsInput) {
    if (seen.has(id)) {
      if (!duplicateSelectedIds.includes(id)) {
        duplicateSelectedIds.push(id);
      }
      continue;
    }
    seen.add(id);

    if (args.firstFrameAssetId && id === args.firstFrameAssetId) {
      firstFrameConflict = true;
      invalidSelectedIds.push(id);
      continue;
    }

    const candidate = byId.get(id);
    if (!candidate) {
      invalidSelectedIds.push(id);
      continue;
    }
    if (!candidate.eligible) {
      unavailableIds.push(id);
      invalidSelectedIds.push(id);
    }
  }

  if (duplicateSelectedIds.length > 0) {
    errors.push(invalidReferenceSelectionError());
  }
  if (firstFrameConflict) {
    errors.push(firstFrameInSelectionError());
  }
  if (unavailableIds.length > 0) {
    errors.push(referenceMediaNotAvailableError());
  }
  if (
    invalidSelectedIds.some(
      (id) =>
        !unavailableIds.includes(id) && id !== args.firstFrameAssetId,
    )
  ) {
    errors.push(invalidReferenceSelectionError());
  }

  const uniqueOrderedIds: string[] = [];
  const uniqueSeen = new Set<string>();
  for (const id of selectedIdsInput) {
    if (uniqueSeen.has(id)) continue;
    uniqueSeen.add(id);
    uniqueOrderedIds.push(id);
  }

  if (uniqueOrderedIds.length > limit) {
    errors.push(referenceMediaLimitExceededError(limit));
  }

  if (errors.length > 0) {
    return {
      mode,
      limit,
      selected: [],
      excluded: candidates.slice(),
      invalidSelectedIds,
      duplicateSelectedIds,
      requiresManualSelection: false,
      validationErrors: dedupeErrors(errors),
    };
  }

  const selected: ReferenceMediaCandidate[] = [];
  for (const id of uniqueOrderedIds) {
    const c = byId.get(id);
    if (c) selected.push(c);
  }
  const selectedSet = new Set(selected.map((c) => c.assetId));
  return {
    mode,
    limit,
    selected,
    excluded: candidates.filter((c) => !selectedSet.has(c.assetId)),
    invalidSelectedIds: [],
    duplicateSelectedIds: [],
    requiresManualSelection: false,
    validationErrors: [],
  };
}

function dedupeErrors(
  errors: StructuredGenerationError[],
): StructuredGenerationError[] {
  const seen = new Set<string>();
  const out: StructuredGenerationError[] = [];
  for (const e of errors) {
    const key = `${e.code}:${e.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
