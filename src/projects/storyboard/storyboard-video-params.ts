import type { VideoResolution } from "@/video-generation/types";
import {
  STORYBOARD_VIDEO_ASPECT_RATIO,
  STORYBOARD_VIDEO_RESOLUTION,
  estimateStoryboardVideoCredits,
} from "@/projects/storyboard/storyboard-video-constants";
import {
  DEFAULT_STORYBOARD_VIDEO_MODEL_CHOICE,
  parseStoryboardVideoModelChoice,
  parseStoryboardVideoStylePreset,
  type StoryboardVideoModelChoiceId,
  type StoryboardVideoStylePresetId,
} from "@/projects/storyboard/storyboard-video-model-choices";

export const STORYBOARD_VIDEO_RESOLUTIONS: VideoResolution[] = [
  "480P",
  "720P",
  "1080P",
];

export const STORYBOARD_VIDEO_ASPECT_RATIOS: Array<"16:9" | "9:16"> = [
  "16:9",
  "9:16",
];

/** 本项目通用视频生成出参可选时长（秒）；非分镜 Clip 场景仍用 5–15 */
export const STORYBOARD_VIDEO_DURATION_MIN = 5;
export const STORYBOARD_VIDEO_DURATION_MAX = 15;

/** 分镜最终 PromptClip 总时长（秒）：仅允许 13、14、15 */
export const STORYBOARD_SHOT_DURATION_MIN = 13;
export const STORYBOARD_SHOT_DURATION_MAX = 15;
/** 分镜 Clip 内部时间轴单段最长秒数（硬上限；模型宜优先 ≤5 秒） */
export const STORYBOARD_INTERNAL_SHOT_DURATION_MAX = 6;
/** 分镜 Clip 内部时间轴镜头数量 */
export const STORYBOARD_INTERNAL_SHOT_COUNT_MIN = 3;
export const STORYBOARD_INTERNAL_SHOT_COUNT_MAX = 5;

/**
 * 分镜提示词规则版本；重新生成通过校验后写入 shot。
 * R2：内部 3–5 段、单段最长 6 秒、人物站位可选。
 */
export const STORYBOARD_PROMPT_RULE_VERSION = "V5-13S-R2";
/** 可直接用于视频提交的兼容规则版本（规则放宽，旧版仍合法） */
export const STORYBOARD_PROMPT_RULE_COMPATIBLE_VERSIONS = [
  "V5-13S",
  "V5-13S-R2",
] as const;

export function isCompatibleStoryboardPromptRuleVersion(
  version: string | null | undefined,
): boolean {
  if (!version?.trim()) return false;
  return (STORYBOARD_PROMPT_RULE_COMPATIBLE_VERSIONS as readonly string[]).includes(
    version.trim(),
  );
}
/**
 * 仅用于反馈给大模型的分镜提示词时长要求（任务规则），与通用视频滑条无关。
 */
export const STORYBOARD_PROMPT_DURATION_MIN = STORYBOARD_SHOT_DURATION_MIN;
export const STORYBOARD_PROMPT_DURATION_MAX = STORYBOARD_SHOT_DURATION_MAX;

/** 项目级视频生成默认设置（持久化到分镜 workspace） */
export type StoryboardVideoDefaults = {
  resolution: VideoResolution;
  aspectRatio: "16:9" | "9:16";
  modelChoice: StoryboardVideoModelChoiceId;
  stylePreset: StoryboardVideoStylePresetId;
};

export type StoryboardVideoOutputParams = {
  resolution: VideoResolution;
  aspectRatio: "16:9" | "9:16";
  durationSeconds: number;
  modelChoice: StoryboardVideoModelChoiceId;
  stylePreset: StoryboardVideoStylePresetId;
};

export function defaultStoryboardVideoDefaults(): StoryboardVideoDefaults {
  return {
    resolution: STORYBOARD_VIDEO_RESOLUTION,
    aspectRatio: STORYBOARD_VIDEO_ASPECT_RATIO === "9:16" ? "9:16" : "16:9",
    modelChoice: DEFAULT_STORYBOARD_VIDEO_MODEL_CHOICE,
    stylePreset: "",
  };
}

export function parseStoryboardVideoDefaults(
  value: unknown,
): StoryboardVideoDefaults | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const base = defaultStoryboardVideoDefaults();
  return {
    resolution: parseStoryboardVideoResolution(raw.resolution) ?? base.resolution,
    aspectRatio:
      parseStoryboardVideoAspectRatio(raw.aspectRatio) ?? base.aspectRatio,
    modelChoice:
      parseStoryboardVideoModelChoice(raw.modelChoice) ?? base.modelChoice,
    stylePreset: parseStoryboardVideoStylePreset(raw.stylePreset),
  };
}

export function isValidStoryboardClipDuration(seconds: number): boolean {
  const n = Math.round(seconds);
  return (
    n === STORYBOARD_SHOT_DURATION_MIN ||
    n === STORYBOARD_SHOT_DURATION_MIN + 1 ||
    n === STORYBOARD_SHOT_DURATION_MAX
  );
}

/** 分镜 Clip 提交时长：非法值回落到 13 秒（仅 UI 缺省，不用于 LLM 解析） */
export function clampStoryboardClipDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return STORYBOARD_SHOT_DURATION_MIN;
  const n = Math.round(seconds);
  if (isValidStoryboardClipDuration(n)) return n;
  if (n < STORYBOARD_SHOT_DURATION_MIN) return STORYBOARD_SHOT_DURATION_MIN;
  if (n > STORYBOARD_SHOT_DURATION_MAX) return STORYBOARD_SHOT_DURATION_MAX;
  return STORYBOARD_SHOT_DURATION_MIN;
}

export function defaultStoryboardVideoOutputParams(
  shotDurationSeconds?: number,
  projectDefaults?: StoryboardVideoDefaults | null,
): StoryboardVideoOutputParams {
  const raw = Math.round(
    shotDurationSeconds ?? STORYBOARD_SHOT_DURATION_MIN,
  );
  const defaults = projectDefaults ?? defaultStoryboardVideoDefaults();
  const durationSeconds = isValidStoryboardClipDuration(raw)
    ? raw
    : clampStoryboardClipDuration(raw);
  return {
    resolution: defaults.resolution,
    aspectRatio: defaults.aspectRatio,
    durationSeconds,
    modelChoice: defaults.modelChoice,
    stylePreset: defaults.stylePreset,
  };
}

/** 通用视频出参钳制到 5–15 秒（个人视频等） */
export function clampStoryboardVideoDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return STORYBOARD_VIDEO_DURATION_MIN;
  return Math.min(
    STORYBOARD_VIDEO_DURATION_MAX,
    Math.max(STORYBOARD_VIDEO_DURATION_MIN, Math.round(seconds)),
  );
}

/**
 * 大模型分镜反馈时长：仅接受 13、14、15 秒；禁止向上/向下自动修正。
 */
export function adoptModelStoryboardDurationSeconds(
  seconds: number,
): number | null {
  if (!Number.isFinite(seconds)) return null;
  const n = Math.round(seconds);
  return isValidStoryboardClipDuration(n) ? n : null;
}

export function parseStoryboardVideoResolution(
  value: unknown,
): VideoResolution | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "480P" ||
    normalized === "720P" ||
    normalized === "1080P"
  ) {
    return normalized;
  }
  return null;
}

export function parseStoryboardVideoAspectRatio(
  value: unknown,
): "16:9" | "9:16" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized === "16:9" || normalized === "9:16") return normalized;
  return null;
}

/** 分镜视频提交：仅接受 13、14、15 秒 */
export function parseStoryboardClipDurationSeconds(
  value: unknown,
): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return isValidStoryboardClipDuration(rounded) ? rounded : null;
}

/** @deprecated 通用 5–15 秒；分镜提交请用 parseStoryboardClipDurationSeconds */
export function parseStoryboardVideoDurationSeconds(
  value: unknown,
): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  return clampStoryboardVideoDuration(n);
}

const CLIP_HEADER_DURATION_RE =
  /[【\[]Clip[^\]】]*总时长\s*[：:]\s*(\d+(?:\.\d+)?)\s*秒[^\]】]*[\]】]/i;
const SHOT_HEADER_DURATION_RE =
  /[【\[]分镜[^\]】]*总时长\s*[：:]\s*(\d+(?:\.\d+)?)\s*秒[^\]】]*[\]】]/;

/**
 * 从大模型分镜正文头解析 Clip / 分镜总时长。
 * 严格采用模型反馈：仅 13、14、15 秒合法；无总时长或越界返回 null。
 */
export function parseDurationSecondsFromVideoPrompt(
  prompt: string,
): number | null {
  const text = prompt?.trim();
  if (!text) return null;
  for (const re of [CLIP_HEADER_DURATION_RE, SHOT_HEADER_DURATION_RE]) {
    const header = text.match(re);
    if (header?.[1]) {
      return adoptModelStoryboardDurationSeconds(Number(header[1]));
    }
  }
  const any = text.match(/总时长\s*[：:]\s*(\d+(?:\.\d+)?)\s*秒/);
  if (any?.[1]) {
    return adoptModelStoryboardDurationSeconds(Number(any[1]));
  }
  return null;
}

/** 从请求 body 解析分镜出站参数；缺省项用默认值 */
export function resolveStoryboardVideoOutputParams(
  body: Record<string, unknown>,
  fallbackDurationSeconds?: number,
  projectDefaults?: StoryboardVideoDefaults | null,
): StoryboardVideoOutputParams {
  const defaults = defaultStoryboardVideoOutputParams(
    fallbackDurationSeconds,
    projectDefaults,
  );
  return {
    resolution:
      parseStoryboardVideoResolution(body.resolution) ?? defaults.resolution,
    aspectRatio:
      parseStoryboardVideoAspectRatio(body.aspectRatio) ?? defaults.aspectRatio,
    durationSeconds:
      parseStoryboardClipDurationSeconds(body.durationSeconds) ??
      defaults.durationSeconds,
    modelChoice:
      parseStoryboardVideoModelChoice(body.videoModelChoice) ??
      parseStoryboardVideoModelChoice(body.modelChoice) ??
      defaults.modelChoice,
    stylePreset:
      body.stylePreset !== undefined
        ? parseStoryboardVideoStylePreset(body.stylePreset)
        : defaults.stylePreset,
  };
}

/** 前端预计费用展示；实际扣费以服务端 quote 为准。 */
export function estimateCreditsForStoryboardVideoOutput(
  params: Pick<StoryboardVideoOutputParams, "resolution" | "durationSeconds">,
): number | null {
  return estimateStoryboardVideoCredits(
    params.durationSeconds,
    params.resolution,
  );
}
