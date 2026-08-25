/** Structured PromptClip payload from LLM before server-side V5 render. */

export type StoryboardClipSegment = {
  start: number;
  end: number;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  visualAction: string;
  dialogue: string;
  speaker: string;
};

export type StoryboardStructuredClip = {
  shotId: string;
  durationSeconds: 13 | 14 | 15;
  rhythmLabel?: string;
  sceneTitle?: string;
  shotNumber?: number;
  /** Logical names only; server builds mount line from shot bindings. */
  characterNames?: string[];
  sceneName?: string;
  propNames?: string[];
  /**
   * @deprecated Model must not generate mount lines. Parser may accept then discard.
   */
  mountLine?: string;
  characterBlocking?: string;
  segments: StoryboardClipSegment[];
  continuity: string;
  sound: string;
  negative?: string;
};

export type StoryboardClipsModelResponse = {
  clips: StoryboardStructuredClip[];
};

export type StoryboardClipValidationIssue = {
  shotId: string;
  shotNumber: number;
  code: string;
  message: string;
};

/** Non-blocking gaps — generation still succeeds and prompts are saved. */
export type StoryboardClipWarning = {
  shotId: string;
  shotNumber: number;
  code: string;
  message: string;
};

/**
 * Hard blockers only: Clip duration, per-segment duration bounds,
 * unusable/empty prompt integrity, forged asset ids, missing model clip.
 */
export const BLOCKING_CLIP_VALIDATION_CODES = new Set<string>([
  "EMPTY_PROMPT",
  "INVALID_CLIP_DURATION",
  "MISSING_CLIP_DURATION",
  "MISSING_TIMELINE",
  "INTERNAL_SHOT_TOO_LONG",
  "INTERNAL_SHOT_DURATION_EXCEEDED",
  "INTERNAL_SHOT_TOO_SHORT",
  "BARE_ASSET_ID_IN_PROMPT",
  "DUPLICATE_SHOT_ID",
  "UNKNOWN_SHOT_ID",
  "MISSING_SHOT_CLIP",
  "PLACEHOLDER_TEMPLATE",
]);

/** Soft content / character / asset / suggested structure — never block save. */
export const SOFT_CLIP_WARNING_CODES = new Set<string>([
  "CHARACTER_BINDING_INCOMPLETE",
  "CHARACTER_ASSET_NOT_FOUND",
  "CHARACTER_ASSET_NO_MEDIA",
  "MISSING_MOUNT_LINE",
  "MISSING_CHARACTER_ASSET_MOUNT",
  "MISSING_CHARACTER_BLOCKING",
  "MISSING_REQUIRED_CHARACTER",
  "MISSING_CONTINUITY",
  "MISSING_SOUND",
  "TOO_FEW_INTERNAL_SHOTS",
  "TOO_MANY_INTERNAL_SHOTS",
  "TIMELINE_GAP",
  "TIMELINE_OVERLAP",
  "TIMELINE_NOT_FROM_ZERO",
  "TIMELINE_NOT_START_AT_ZERO",
  "TIMELINE_END_MISMATCH",
  "TIMELINE_TOTAL_MISMATCH",
  "DIALOGUE_NOT_VERBATIM",
  "GENERIC_CHARACTER_PLACEHOLDER",
]);

export function isBlockingClipValidationCode(code: string): boolean {
  return BLOCKING_CLIP_VALIDATION_CODES.has(code);
}

export function isSoftClipWarningCode(code: string): boolean {
  return SOFT_CLIP_WARNING_CODES.has(code) || !isBlockingClipValidationCode(code);
}

/** @deprecated Use isSoftClipWarningCode / isBlockingClipValidationCode */
export const CHARACTER_ASSET_WARNING_CODES = SOFT_CLIP_WARNING_CODES;

/** @deprecated Use isSoftClipWarningCode */
export function isCharacterAssetWarningCode(code: string): boolean {
  return isSoftClipWarningCode(code);
}

export function partitionClipValidationIssues(
  issues: Array<{ shotId: string; shotNumber: number; code: string; message: string }>,
): {
  errors: StoryboardClipValidationIssue[];
  warnings: StoryboardClipWarning[];
} {
  const errors: StoryboardClipValidationIssue[] = [];
  const warnings: StoryboardClipWarning[] = [];
  for (const issue of issues) {
    if (isBlockingClipValidationCode(issue.code)) {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  }
  return { errors, warnings };
}
