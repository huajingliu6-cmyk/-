import type { StoryboardDocument, StoryboardShot } from "@/projects/storyboard/types";
import {
  STORYBOARD_INTERNAL_SHOT_COUNT_MAX,
  STORYBOARD_INTERNAL_SHOT_COUNT_MIN,
  STORYBOARD_INTERNAL_SHOT_DURATION_MAX,
  STORYBOARD_SHOT_DURATION_MAX,
  STORYBOARD_SHOT_DURATION_MIN,
  isCompatibleStoryboardPromptRuleVersion,
  isValidStoryboardClipDuration,
  parseDurationSecondsFromVideoPrompt,
} from "@/projects/storyboard/storyboard-video-params";
import {
  partitionClipValidationIssues,
  type StoryboardClipValidationIssue,
  type StoryboardClipWarning,
} from "@/projects/storyboard/services/storyboard-clip-types";

export type StoryboardPromptValidationIssue = {
  shotId: string;
  shotNumber: number;
  code: string;
  message: string;
};

const PLACEHOLDER_TEMPLATE_RE =
  /^景别：[\s\S]*镜头角度：[\s\S]*运镜：[\s\S]*人物：[\s\S]*动作与画面：/;

const TIMELINE_SEGMENT_RE =
  /(\d+(?:\.\d+)?)\s*[-–—~至到]\s*(\d+(?:\.\d+)?)\s*秒/g;

function looksLikePlaceholderTemplate(prompt: string): boolean {
  return PLACEHOLDER_TEMPLATE_RE.test(prompt.trim());
}

export type TimelineSegment = { start: number; end: number };

export function parseTimelineSegments(prompt: string): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  for (const match of prompt.matchAll(TIMELINE_SEGMENT_RE)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    segments.push({ start, end });
  }
  return segments;
}

function validateTimelineSegments(
  shot: StoryboardShot,
  prompt: string,
  totalDuration: number,
): StoryboardPromptValidationIssue[] {
  const issues: StoryboardPromptValidationIssue[] = [];
  const base = { shotId: shot.id, shotNumber: shot.shotNumber };
  const segments = parseTimelineSegments(prompt);

  if (segments.length < 1) {
    issues.push({
      ...base,
      code: "MISSING_TIMELINE",
      message: "缺少分秒时间轴",
    });
    return issues;
  }

  if (segments.length < STORYBOARD_INTERNAL_SHOT_COUNT_MIN) {
    issues.push({
      ...base,
      code: "TOO_FEW_INTERNAL_SHOTS",
      message: `内部镜头数量为 ${segments.length} 个（建议 ${STORYBOARD_INTERNAL_SHOT_COUNT_MIN}–${STORYBOARD_INTERNAL_SHOT_COUNT_MAX} 个）`,
    });
  }

  if (segments.length > STORYBOARD_INTERNAL_SHOT_COUNT_MAX) {
    issues.push({
      ...base,
      code: "TOO_MANY_INTERNAL_SHOTS",
      message: `内部镜头数量为 ${segments.length} 个（建议最多 ${STORYBOARD_INTERNAL_SHOT_COUNT_MAX} 个）`,
    });
  }

  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const epsilon = 0.05;

  if (Math.abs(sorted[0]!.start) > epsilon) {
    issues.push({
      ...base,
      code: "TIMELINE_NOT_FROM_ZERO",
      message: `时间轴从 ${sorted[0]!.start} 秒开始，建议从 0 秒开始`,
    });
  }

  for (let i = 0; i < sorted.length; i += 1) {
    const seg = sorted[i]!;
    const duration = seg.end - seg.start;
    if (duration > STORYBOARD_INTERNAL_SHOT_DURATION_MAX + epsilon) {
      issues.push({
        ...base,
        code: "INTERNAL_SHOT_TOO_LONG",
        message: `内部镜头 ${seg.start}–${seg.end} 秒超过 ${STORYBOARD_INTERNAL_SHOT_DURATION_MAX} 秒`,
      });
    }
    if (i > 0) {
      const prev = sorted[i - 1]!;
      if (Math.abs(seg.start - prev.end) > epsilon) {
        if (seg.start < prev.end - epsilon) {
          issues.push({
            ...base,
            code: "TIMELINE_OVERLAP",
            message: `时间轴 ${seg.start}–${seg.end} 秒与上一段重叠`,
          });
        } else {
          issues.push({
            ...base,
            code: "TIMELINE_GAP",
            message: `时间轴在 ${prev.end}–${seg.start} 秒出现空档`,
          });
        }
      }
    }
  }

  const last = sorted[sorted.length - 1]!;
  if (Math.abs(last.end - totalDuration) > epsilon) {
    issues.push({
      ...base,
      code: "TIMELINE_END_MISMATCH",
      message: `时间轴结束于 ${last.end} 秒，但 Clip 总时长为 ${totalDuration} 秒`,
    });
  }

  return issues;
}

export type ShotPromptValidationResult = {
  errors: StoryboardPromptValidationIssue[];
  warnings: StoryboardPromptValidationIssue[];
};

/** Flat list for callers that still expect a single array (errors first). */
export function validateShotPrompt(
  shot: StoryboardShot,
  options?: { requireCharacterAssetMount?: boolean },
): StoryboardPromptValidationIssue[] {
  const { errors, warnings } = validateShotPromptPartitioned(shot, options);
  return [...errors, ...warnings];
}

export function validateShotPromptPartitioned(
  shot: StoryboardShot,
  options?: { requireCharacterAssetMount?: boolean },
): ShotPromptValidationResult {
  const collected: StoryboardPromptValidationIssue[] = [];
  const prompt = shot.videoPrompt?.trim() ?? "";
  const base = { shotId: shot.id, shotNumber: shot.shotNumber };

  if (!prompt) {
    collected.push({
      ...base,
      code: "EMPTY_PROMPT",
      message: "分镜提示词为空",
    });
    return partitionClipValidationIssues(collected);
  }

  if (prompt.includes("主要人物")) {
    collected.push({
      ...base,
      code: "GENERIC_CHARACTER_PLACEHOLDER",
      message: "提示词包含泛化占位词「主要人物」",
    });
  }

  if (looksLikePlaceholderTemplate(prompt)) {
    collected.push({
      ...base,
      code: "PLACEHOLDER_TEMPLATE",
      message: "提示词仍为本地占位模板，未符合分镜任务规则格式",
    });
  }

  const totalDuration = parseDurationSecondsFromVideoPrompt(prompt);
  if (totalDuration == null) {
    collected.push({
      ...base,
      code: "MISSING_CLIP_DURATION",
      message: "缺少 Clip 总时长（必须为 13–15 秒）",
    });
  } else if (!isValidStoryboardClipDuration(totalDuration)) {
    collected.push({
      ...base,
      code: "INVALID_CLIP_DURATION",
      message: `总时长为 ${totalDuration} 秒，必须为 ${STORYBOARD_SHOT_DURATION_MIN}–${STORYBOARD_SHOT_DURATION_MAX} 秒`,
    });
  }

  if (totalDuration != null && isValidStoryboardClipDuration(totalDuration)) {
    collected.push(...validateTimelineSegments(shot, prompt, totalDuration));
  } else if (!/\d+(?:\.\d+)?\s*[-–—~至到]\s*\d+(?:\.\d+)?\s*秒/.test(prompt)) {
    collected.push({
      ...base,
      code: "MISSING_TIMELINE",
      message: "缺少分秒时间轴",
    });
  }

  for (const name of shot.requiredCharacters) {
    const trimmed = name.trim();
    if (trimmed && !prompt.includes(trimmed)) {
      collected.push({
        ...base,
        code: "MISSING_REQUIRED_CHARACTER",
        message: `提示词未明确写出人物「${trimmed}」，已按剧本继续生成`,
      });
    }
  }

  const hasCharacters =
    (shot.requiredCharacters?.some((name) => name.trim()) ?? false) ||
    (shot.characterAssetIds?.length ?? 0) > 0 ||
    Boolean(shot.dialogue?.trim());

  const characterAssetIds = shot.characterAssetIds ?? [];
  if (hasCharacters && characterAssetIds.length > 0) {
    const requireMount = options?.requireCharacterAssetMount !== false;
    if (requireMount && !/挂载[：:]/.test(prompt)) {
      collected.push({
        ...base,
        code: "MISSING_MOUNT_LINE",
        message: "缺少人物/场景/道具挂载行",
      });
    } else if (/挂载[：:]/.test(prompt) && requireMount) {
      for (const assetId of characterAssetIds) {
        const imageToken = new RegExp(
          `【图:${assetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`,
        );
        if (!imageToken.test(prompt)) {
          collected.push({
            ...base,
            code: "MISSING_CHARACTER_ASSET_MOUNT",
            message: "本镜人物资产挂载图片引用缺失",
          });
        }
      }
    }
  }

  if (!/连续性/.test(prompt)) {
    collected.push({
      ...base,
      code: "MISSING_CONTINUITY",
      message: "缺少连续性约束",
    });
  }

  if (/(?:^|[\s｜|,，])assetId\s*[:=]/i.test(prompt)) {
    collected.push({
      ...base,
      code: "BARE_ASSET_ID_IN_PROMPT",
      message: "最终提示词不得包含裸 assetId 字段",
    });
  }

  return partitionClipValidationIssues(collected);
}

export function validateGeneratedStoryboardPrompts(input: {
  storyboard: StoryboardDocument;
  targetShotIds: Iterable<string>;
}): StoryboardPromptValidationIssue[] {
  const { errors, warnings } = validateGeneratedStoryboardPromptsPartitioned(input);
  return [...errors, ...warnings];
}

export function validateGeneratedStoryboardPromptsPartitioned(input: {
  storyboard: StoryboardDocument;
  targetShotIds: Iterable<string>;
}): {
  errors: StoryboardPromptValidationIssue[];
  warnings: StoryboardPromptValidationIssue[];
} {
  const targetIds = new Set(input.targetShotIds);
  const errors: StoryboardPromptValidationIssue[] = [];
  const warnings: StoryboardPromptValidationIssue[] = [];
  for (const scene of input.storyboard.scenes) {
    for (const shot of scene.shots) {
      if (!targetIds.has(shot.id)) continue;
      const prompt = shot.videoPrompt?.trim() || shot.promptDraft?.trim() || "";
      const hasMount = /挂载[：:]/.test(prompt);
      const partitioned = validateShotPromptPartitioned(shot, {
        requireCharacterAssetMount: hasMount,
      });
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

/** 旧版或未通过 V5-13S 系校验的提示词视为过期；V5-13S 与 V5-13S-R2 均兼容 */
export function isStoryboardPromptRuleExpired(shot: StoryboardShot): boolean {
  if (!isCompatibleStoryboardPromptRuleVersion(shot.storyboardPromptRuleVersion)) {
    return true;
  }
  const prompt =
    shot.videoPrompt?.trim() || shot.promptDraft?.trim() || "";
  const fromPrompt = parseDurationSecondsFromVideoPrompt(prompt);
  if (fromPrompt != null) {
    return !isValidStoryboardClipDuration(fromPrompt);
  }
  return !isValidStoryboardClipDuration(shot.durationSeconds);
}
