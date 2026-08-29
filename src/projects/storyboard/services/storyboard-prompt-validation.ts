import type { StoryboardDocument, StoryboardShot } from "@/projects/storyboard/types";
import {
  partitionClipValidationIssues,
  type StoryboardClipValidationIssue,
  type StoryboardClipWarning,
} from "@/projects/storyboard/services/storyboard-clip-types";
import { STORYBOARD_PROMPT_RULE_VERSION } from "@/projects/storyboard/storyboard-video-params";

export type StoryboardPromptValidationIssue = {
  shotId: string;
  shotNumber: number;
  code: string;
  message: string;
};

export type ShotPromptValidationResult = {
  errors: StoryboardPromptValidationIssue[];
  warnings: StoryboardPromptValidationIssue[];
};

/**
 * Structural checks only: non-empty videoPrompt.
 * Does not enforce PromptClip / timeline / sound / continuity sections.
 */
export function validateShotPromptPartitioned(
  shot: StoryboardShot,
  _options?: { requireCharacterAssetMount?: boolean },
): ShotPromptValidationResult {
  void _options;
  const prompt = shot.videoPrompt?.trim() ?? "";
  const collected: StoryboardPromptValidationIssue[] = [];
  if (!prompt) {
    collected.push({
      shotId: shot.id,
      shotNumber: shot.shotNumber,
      code: "EMPTY_PROMPT",
      message: "分镜提示词为空",
    });
  }
  return partitionClipValidationIssues(collected);
}

/** Flat list for callers that still expect a single array (errors first). */
export function validateShotPrompt(
  shot: StoryboardShot,
  options?: { requireCharacterAssetMount?: boolean },
): StoryboardPromptValidationIssue[] {
  const { errors, warnings } = validateShotPromptPartitioned(shot, options);
  return [...errors, ...warnings];
}

export function validateGeneratedStoryboardPrompts(input: {
  storyboard: StoryboardDocument;
  targetShotIds: Iterable<string>;
}): StoryboardPromptValidationIssue[] {
  const { errors, warnings } =
    validateGeneratedStoryboardPromptsPartitioned(input);
  return [...errors, ...warnings];
}

export function validateGeneratedStoryboardPromptsPartitioned(input: {
  storyboard: StoryboardDocument;
  targetShotIds: Iterable<string>;
}): ShotPromptValidationResult {
  const targetIds = new Set(input.targetShotIds);
  const errors: StoryboardPromptValidationIssue[] = [];
  const warnings: StoryboardPromptValidationIssue[] = [];
  for (const scene of input.storyboard.scenes) {
    for (const shot of scene.shots) {
      if (!targetIds.has(shot.id)) continue;
      const partitioned = validateShotPromptPartitioned(shot);
      errors.push(...partitioned.errors);
      warnings.push(...partitioned.warnings);
    }
  }
  return { errors, warnings };
}

export function formatStoryboardPromptValidationError(
  issues: StoryboardPromptValidationIssue[],
): string {
  if (issues.length === 0) return "分镜提示词未通过规则校验";
  const preview = issues
    .slice(0, 4)
    .map((issue) => `镜头${issue.shotNumber}：${issue.message}`)
    .join("；");
  const suffix =
    issues.length > 4 ? `（另有 ${issues.length - 4} 项）` : "";
  return `分镜提示词未通过规则校验：${preview}${suffix}`;
}

/**
 * Auto prompts expire when empty or rule version ≠ current SHOT_ID_PROMPT_V1.
 * Manual locked prompts are never treated as expired here.
 */
export function isStoryboardPromptRuleExpired(shot: StoryboardShot): boolean {
  if (shot.promptOrigin === "manual" && shot.promptLocked) return false;
  const prompt =
    shot.videoPrompt?.trim() || shot.promptDraft?.trim() || "";
  if (!prompt) return true;
  const ver = shot.storyboardPromptRuleVersion?.trim() || "";
  return ver !== STORYBOARD_PROMPT_RULE_VERSION;
}

/** Whether batch/auto prompt fill may overwrite this shot. */
export function isShotPromptProtectedFromAutoRegen(
  shot: StoryboardShot,
): boolean {
  if (shot.locked) return true;
  if (shot.promptOrigin === "manual" && shot.promptLocked) return true;
  return false;
}

/**
 * Unlock expired auto prompts so the next fill regenerates them.
 * Manual locks and whole-shot locks are preserved.
 */
export function unlockExpiredAutoStoryboardPrompts(
  storyboard: StoryboardDocument,
): StoryboardDocument {
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => {
        if (isShotPromptProtectedFromAutoRegen(shot)) return shot;
        if (!isStoryboardPromptRuleExpired(shot)) return shot;
        return {
          ...shot,
          promptLocked: false,
          promptNeedsReview: true,
        };
      }),
    })),
  };
}

/** Force-unlock all auto prompts (keep manual / whole-shot locks). */
export function unlockAllAutoStoryboardPrompts(
  storyboard: StoryboardDocument,
): StoryboardDocument {
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => {
        if (isShotPromptProtectedFromAutoRegen(shot)) return shot;
        return {
          ...shot,
          promptLocked: false,
          promptNeedsReview: true,
        };
      }),
    })),
  };
}

/** @deprecated Timeline parsing is not part of SHOT_ID_PROMPT_V1. */
export type TimelineSegment = { start: number; end: number };

/** @deprecated */
export function parseTimelineSegments(_prompt: string): TimelineSegment[] {
  return [];
}

export type { StoryboardClipValidationIssue, StoryboardClipWarning };
