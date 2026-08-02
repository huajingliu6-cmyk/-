import type { VideoAspectRatio, VideoResolution } from "@/video-generation/types";
import {
  STORYBOARD_VIDEO_ASPECT_RATIO,
  STORYBOARD_VIDEO_RESOLUTION,
} from "@/projects/storyboard/storyboard-video-constants";

export const STORYBOARD_VIDEO_RESOLUTIONS: VideoResolution[] = [
  "480P",
  "720P",
  "1080P",
];

export const STORYBOARD_VIDEO_ASPECT_RATIOS: Array<"16:9" | "9:16"> = [
  "16:9",
  "9:16",
];

/** UI 可选时长范围（秒）；提交时仍会按模型 capability 再钳制 */
export const STORYBOARD_VIDEO_DURATION_MIN = 5;
export const STORYBOARD_VIDEO_DURATION_MAX = 15;

export type StoryboardVideoOutputParams = {
  resolution: VideoResolution;
  aspectRatio: "16:9" | "9:16";
  durationSeconds: number;
};

export function defaultStoryboardVideoOutputParams(
  shotDurationSeconds?: number,
): StoryboardVideoOutputParams {
  const raw = Math.round(shotDurationSeconds ?? STORYBOARD_VIDEO_DURATION_MIN);
  return {
    resolution: STORYBOARD_VIDEO_RESOLUTION,
    aspectRatio: STORYBOARD_VIDEO_ASPECT_RATIO === "9:16" ? "9:16" : "16:9",
    durationSeconds: clampStoryboardVideoDuration(raw),
  };
}

export function clampStoryboardVideoDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return STORYBOARD_VIDEO_DURATION_MIN;
  return Math.min(
    STORYBOARD_VIDEO_DURATION_MAX,
    Math.max(STORYBOARD_VIDEO_DURATION_MIN, Math.round(seconds)),
  );
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

/** 从请求 body 解析出站参数；缺省项用默认值 */
export function resolveStoryboardVideoOutputParams(
  body: Record<string, unknown>,
  fallbackDurationSeconds?: number,
): StoryboardVideoOutputParams {
  const defaults = defaultStoryboardVideoOutputParams(fallbackDurationSeconds);
  return {
    resolution:
      parseStoryboardVideoResolution(body.resolution) ?? defaults.resolution,
    aspectRatio:
      parseStoryboardVideoAspectRatio(body.aspectRatio) ?? defaults.aspectRatio,
    durationSeconds:
      parseStoryboardVideoDurationSeconds(body.durationSeconds) ??
      defaults.durationSeconds,
  };
}
