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

/** 本项目视频生成出参可选时长（秒）；滑条/提交钳制范围 */
export const STORYBOARD_VIDEO_DURATION_MIN = 5;
export const STORYBOARD_VIDEO_DURATION_MAX = 15;

/**
 * 仅用于反馈给大模型的分镜提示词时长要求（任务规则），与视频滑条无关。
 */
export const STORYBOARD_PROMPT_DURATION_MIN = 9;
export const STORYBOARD_PROMPT_DURATION_MAX = 15;

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

export function defaultStoryboardVideoOutputParams(
  shotDurationSeconds?: number,
  projectDefaults?: StoryboardVideoDefaults | null,
): StoryboardVideoOutputParams {
  const raw = Math.round(shotDurationSeconds ?? STORYBOARD_VIDEO_DURATION_MIN);
  const defaults = projectDefaults ?? defaultStoryboardVideoDefaults();
  return {
    resolution: defaults.resolution,
    aspectRatio: defaults.aspectRatio,
    durationSeconds: clampStoryboardVideoDuration(raw),
    modelChoice: defaults.modelChoice,
    stylePreset: defaults.stylePreset,
  };
}

/** 视频出参钳制到 5–15 秒 */
export function clampStoryboardVideoDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return STORYBOARD_VIDEO_DURATION_MIN;
  return Math.min(
    STORYBOARD_VIDEO_DURATION_MAX,
    Math.max(STORYBOARD_VIDEO_DURATION_MIN, Math.round(seconds)),
  );
}

/**
 * 大模型分镜反馈时长：只做上限封顶（≤15），禁止向上拉长。
 * 非法或非正数返回 null。
 */
export function adoptModelStoryboardDurationSeconds(
  seconds: number,
): number | null {
  if (!Number.isFinite(seconds)) return null;
  const n = Math.round(seconds);
  if (n <= 0) return null;
  return Math.min(STORYBOARD_PROMPT_DURATION_MAX, n);
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

/**
 * 从大模型分镜正文头解析时长，例如 `[分镜01｜总时长：12秒｜画幅：9:16]`。
 * 严格采用模型反馈：不估算、不向上拉长；仅将超过 15 秒的值封顶。
 */
export function parseDurationSecondsFromVideoPrompt(
  prompt: string,
): number | null {
  const text = prompt?.trim();
  if (!text) return null;
  const header = text.match(
    /\[分镜[^\]]*总时长\s*[：:]\s*(\d+(?:\.\d+)?)\s*秒[^\]]*\]/,
  );
  if (header?.[1]) {
    return adoptModelStoryboardDurationSeconds(Number(header[1]));
  }
  const any = text.match(/总时长\s*[：:]\s*(\d+(?:\.\d+)?)\s*秒/);
  if (any?.[1]) {
    return adoptModelStoryboardDurationSeconds(Number(any[1]));
  }
  return null;
}

/** 从请求 body 解析出站参数；缺省项用默认值 */
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
      parseStoryboardVideoDurationSeconds(body.durationSeconds) ??
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
