import type { ParsedStoryboardPrompt } from "@/projects/storyboard/services/parse-storyboard-model-response";

export type StoryboardPromptMatchTarget = {
  id: string;
  shotNumber: number;
};

export type MatchStoryboardPromptsResult = {
  /** shotId → videoPrompt (first wins for duplicate model ids) */
  matched: Map<string, string>;
  unmatchedShotIds: string[];
  generatedCount: number;
  unmatchedCount: number;
  /** Model prompts that could not be assigned to any target */
  unusedPromptCount: number;
};

/** Normalize shot ids so shot_001 / shot-001 / shot001 / 001 / 01 / 1 align. */
export function normalizeShotIdKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  const digits = trimmed.match(/(\d+)\s*$/);
  if (digits) {
    return String(Number(digits[1]));
  }
  return trimmed.replace(/[^a-z0-9]+/g, "");
}

export function matchStoryboardPrompts(input: {
  targets: StoryboardPromptMatchTarget[];
  prompts: ParsedStoryboardPrompt[];
  /** When true (single-shot regen), one non-empty prompt matches the only target. */
  singleShotFallback?: boolean;
}): MatchStoryboardPromptsResult {
  const targets = input.targets;
  const matched = new Map<string, string>();
  const claimedPromptIndexes = new Set<number>();

  if (targets.length === 0) {
    return {
      matched,
      unmatchedShotIds: [],
      generatedCount: 0,
      unmatchedCount: 0,
      unusedPromptCount: input.prompts.length,
    };
  }

  const byNormalizedId = new Map<string, string>();
  const byNumber = new Map<number, string>();
  for (const t of targets) {
    byNormalizedId.set(normalizeShotIdKey(t.id), t.id);
    byNumber.set(t.shotNumber, t.id);
    // Also index padded forms via normalizeShotIdKey(String(n))
    byNormalizedId.set(normalizeShotIdKey(String(t.shotNumber)), t.id);
  }

  const tryAssign = (shotId: string, prompt: string, promptIndex: number) => {
    if (!prompt.trim() || matched.has(shotId) || claimedPromptIndexes.has(promptIndex)) {
      return false;
    }
    matched.set(shotId, prompt);
    claimedPromptIndexes.add(promptIndex);
    return true;
  };

  // 1) Exact shotId
  for (let i = 0; i < input.prompts.length; i += 1) {
    const p = input.prompts[i]!;
    const id = p.sourceShotId?.trim();
    if (!id) continue;
    const hit = targets.find((t) => t.id === id);
    if (hit) tryAssign(hit.id, p.videoPrompt, i);
  }

  // 2) Normalized shotId
  for (let i = 0; i < input.prompts.length; i += 1) {
    if (claimedPromptIndexes.has(i)) continue;
    const p = input.prompts[i]!;
    const id = p.sourceShotId?.trim();
    if (!id) continue;
    const mapped = byNormalizedId.get(normalizeShotIdKey(id));
    if (mapped) tryAssign(mapped, p.videoPrompt, i);
  }

  // 3) Shot number
  for (let i = 0; i < input.prompts.length; i += 1) {
    if (claimedPromptIndexes.has(i)) continue;
    const p = input.prompts[i]!;
    const n = p.sourceShotNumber;
    if (n == null) continue;
    const mapped = byNumber.get(n);
    if (mapped) tryAssign(mapped, p.videoPrompt, i);
  }

  // 4) Stable order when counts match
  const remainingTargets = targets.filter((t) => !matched.has(t.id));
  const remainingPrompts = input.prompts
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => !claimedPromptIndexes.has(i));
  if (
    remainingTargets.length > 0 &&
    remainingTargets.length === remainingPrompts.length
  ) {
    for (let i = 0; i < remainingTargets.length; i += 1) {
      tryAssign(
        remainingTargets[i]!.id,
        remainingPrompts[i]!.p.videoPrompt,
        remainingPrompts[i]!.i,
      );
    }
  }

  // 5) Single-shot: any one non-empty prompt
  if (
    input.singleShotFallback &&
    targets.length === 1 &&
    matched.size === 0
  ) {
    const first = input.prompts.find((p) => p.videoPrompt.trim());
    if (first) {
      matched.set(targets[0]!.id, first.videoPrompt);
    }
  }

  const unmatchedShotIds = targets
    .filter((t) => !matched.has(t.id))
    .map((t) => t.id);

  return {
    matched,
    unmatchedShotIds,
    generatedCount: matched.size,
    unmatchedCount: unmatchedShotIds.length,
    unusedPromptCount: Math.max(0, input.prompts.length - matched.size),
  };
}
