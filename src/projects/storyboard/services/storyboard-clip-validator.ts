import {
  STORYBOARD_SHOT_DURATION_MAX,
  STORYBOARD_SHOT_DURATION_MIN,
  isValidStoryboardClipDuration,
} from "@/projects/storyboard/storyboard-video-params";
import {
  shotHasCharacters,
  validateShotCharacterAssetBindings,
} from "@/projects/storyboard/services/storyboard-clip-mount";
import type { MatchableAssets } from "@/projects/storyboard/services/asset-match";
import type {
  StoryboardClipValidationIssue,
  StoryboardClipWarning,
  StoryboardStructuredClip,
} from "@/projects/storyboard/services/storyboard-clip-types";
import { partitionClipValidationIssues } from "@/projects/storyboard/services/storyboard-clip-types";
import type { StoryboardShot } from "@/projects/storyboard/types";

const EPSILON = 0.05;

function normalizeDialogue(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[「」""''‘’']/g, "")
    .trim();
}

function validateSegmentTimeline(
  clip: StoryboardStructuredClip,
  shotNumber: number,
): StoryboardClipValidationIssue[] {
  const issues: StoryboardClipValidationIssue[] = [];
  const base = { shotId: clip.shotId, shotNumber };
  const segments = [...clip.segments].sort((a, b) => a.start - b.start);

  if (segments.length < 1) {
    issues.push({
      ...base,
      code: "MISSING_TIMELINE",
      message: "缺少内部时间轴镜头",
    });
    return issues;
  }

  // No platform min/max internal-shot count or per-segment duration caps.
  // Shot differentiation inside the prompt is owned by the model.

  if (Math.abs(segments[0]!.start) > EPSILON) {
    issues.push({
      ...base,
      code: "TIMELINE_NOT_START_AT_ZERO",
      message: `时间轴从 ${segments[0]!.start} 秒开始，建议从 0 秒开始`,
    });
  }

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!;
    if (i > 0) {
      const prev = segments[i - 1]!;
      if (Math.abs(seg.start - prev.end) > EPSILON) {
        if (seg.start < prev.end - EPSILON) {
          issues.push({
            ...base,
            code: "TIMELINE_OVERLAP",
            message: `时间轴 ${seg.start}–${seg.end} 秒与上一段 ${prev.start}–${prev.end} 秒重叠`,
          });
        } else {
          issues.push({
            ...base,
            code: "TIMELINE_GAP",
            message: `时间轴存在 ${prev.end}–${seg.start} 秒空档`,
          });
        }
      }
    }
  }

  const last = segments[segments.length - 1]!;
  if (Math.abs(last.end - clip.durationSeconds) > EPSILON) {
    issues.push({
      ...base,
      code: "TIMELINE_TOTAL_MISMATCH",
      message: `时间轴结束于 ${last.end} 秒，但 Clip 总时长为 ${clip.durationSeconds} 秒`,
    });
  }

  return issues;
}

export type StructuredClipValidationResult = {
  errors: StoryboardClipValidationIssue[];
  warnings: StoryboardClipWarning[];
};

export function validateStructuredClip(
  clip: StoryboardStructuredClip,
  shot: StoryboardShot,
  options?: { libraryAssets?: MatchableAssets | null },
): StructuredClipValidationResult {
  const collected: StoryboardClipValidationIssue[] = [];
  const base = { shotId: clip.shotId, shotNumber: shot.shotNumber };

  if (!isValidStoryboardClipDuration(clip.durationSeconds)) {
    collected.push({
      ...base,
      code: "INVALID_CLIP_DURATION",
      message: `Clip 总时长为 ${clip.durationSeconds} 秒，必须为 ${STORYBOARD_SHOT_DURATION_MIN}–${STORYBOARD_SHOT_DURATION_MAX} 秒`,
    });
  }

  if (!Array.isArray(clip.segments) || clip.segments.length === 0) {
    collected.push({
      ...base,
      code: "MISSING_TIMELINE",
      message: "缺少内部时间轴镜头",
    });
    return partitionClipValidationIssues(collected);
  }

  collected.push(...validateSegmentTimeline(clip, shot.shotNumber));

  const sourceDialogue = shot.dialogue?.trim() ?? "";
  if (sourceDialogue) {
    const combined = clip.segments
      .map((s) => s.dialogue?.trim() ?? "")
      .filter(Boolean)
      .join("");
    const normalizedSource = normalizeDialogue(sourceDialogue);
    const normalizedOut = normalizeDialogue(combined);
    if (
      normalizedSource &&
      normalizedOut &&
      !normalizedOut.includes(normalizedSource) &&
      normalizedSource !== normalizedOut
    ) {
      collected.push({
        ...base,
        code: "DIALOGUE_NOT_VERBATIM",
        message: "台词与原剧本不完全一致",
      });
    }
  }

  const hasCharacters = shotHasCharacters(shot);

  if (hasCharacters) {
    collected.push(
      ...validateShotCharacterAssetBindings({
        shot,
        libraryAssets: options?.libraryAssets,
      }),
    );

    for (const name of shot.requiredCharacters) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const inClip =
        clip.segments.some(
          (s) =>
            s.speaker.includes(trimmed) ||
            s.visualAction.includes(trimmed) ||
            s.dialogue.includes(trimmed),
        ) ||
        (clip.characterBlocking?.includes(trimmed) ?? false) ||
        (clip.characterNames?.some((n) => n.includes(trimmed)) ?? false);
      if (!inClip) {
        collected.push({
          ...base,
          code: "MISSING_REQUIRED_CHARACTER",
          message: `提示词未明确写出人物「${trimmed}」，已按剧本继续生成`,
        });
      }
    }

    if (!clip.characterBlocking?.trim()) {
      collected.push({
        ...base,
        code: "MISSING_CHARACTER_BLOCKING",
        message: "未提供人物站位，已按剧本动作生成",
      });
    }
  }

  if (!clip.continuity?.trim()) {
    collected.push({
      ...base,
      code: "MISSING_CONTINUITY",
      message: "缺少连续性约束",
    });
  }

  if (!clip.sound?.trim()) {
    collected.push({
      ...base,
      code: "MISSING_SOUND",
      message: "缺少声音设计",
    });
  }

  return partitionClipValidationIssues(collected);
}

export function formatClipValidationError(
  issues: StoryboardClipValidationIssue[],
): string {
  if (issues.length === 0) return "分镜 Clip 未通过规则校验";
  const preview = issues
    .slice(0, 4)
    .map((issue) => `镜头${issue.shotNumber}：${issue.message}`)
    .join("；");
  const suffix =
    issues.length > 4 ? `（另有 ${issues.length - 4} 项）` : "";
  return `分镜提示词未通过规则校验：${preview}${suffix}`;
}

export function formatClipWarningsSummary(
  warnings: StoryboardClipWarning[],
): string {
  if (warnings.length === 0) return "";
  return `提示词已生成，部分镜头缺少人物参考图，将使用文字描述生成`;
}
