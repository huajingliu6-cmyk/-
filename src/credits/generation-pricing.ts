import type { GeneratedMediaState } from "@/projects/assets/episode-design/types";
import type { VideoResolution } from "@/video-generation/types";

export const IMAGE_FIRST_GENERATION_CREDITS = 2;
export const IMAGE_SUBSEQUENT_GENERATION_CREDITS = 1;

export const VIDEO_CREDITS_PER_SECOND_480P = 5;
export const VIDEO_CREDITS_PER_SECOND_720P = 10;

export const VIDEO_CREDIT_PRICE_NOT_CONFIGURED = "VIDEO_CREDIT_PRICE_NOT_CONFIGURED";
export const INSUFFICIENT_CREDITS = "INSUFFICIENT_CREDITS";

/** True when this design item has never successfully produced an image. */
export function isFirstImageGeneration(
  generatedMedia: GeneratedMediaState | null | undefined,
): boolean {
  if (!generatedMedia) return true;
  if (typeof generatedMedia.currentId === "string" && generatedMedia.currentId.trim()) {
    return false;
  }
  if (Array.isArray(generatedMedia.historyIds) && generatedMedia.historyIds.length > 0) {
    return false;
  }
  if (Array.isArray(generatedMedia.history) && generatedMedia.history.length > 0) {
    return false;
  }
  return true;
}

export function estimateAssetImageCredits(
  generatedMedia: GeneratedMediaState | null | undefined,
): { points: number; firstGeneration: boolean } {
  const firstGeneration = isFirstImageGeneration(generatedMedia);
  return {
    firstGeneration,
    points: firstGeneration
      ? IMAGE_FIRST_GENERATION_CREDITS
      : IMAGE_SUBSEQUENT_GENERATION_CREDITS,
  };
}

export type VideoCreditQuote =
  | {
      ok: true;
      points: number;
      resolution: VideoResolution;
      durationSeconds: number;
      pointsPerSecond: number;
    }
  | {
      ok: false;
      code: typeof VIDEO_CREDIT_PRICE_NOT_CONFIGURED;
      error: string;
      resolution: VideoResolution;
      durationSeconds: number;
    };

export function quoteStoryboardVideoCredits(input: {
  resolution: VideoResolution | string;
  durationSeconds: number;
}): VideoCreditQuote {
  const durationSeconds = Math.max(1, Math.round(input.durationSeconds));
  const resolution = String(input.resolution).trim().toUpperCase() as VideoResolution;

  if (resolution === "480P") {
    return {
      ok: true,
      points: durationSeconds * VIDEO_CREDITS_PER_SECOND_480P,
      resolution,
      durationSeconds,
      pointsPerSecond: VIDEO_CREDITS_PER_SECOND_480P,
    };
  }
  if (resolution === "720P") {
    return {
      ok: true,
      points: durationSeconds * VIDEO_CREDITS_PER_SECOND_720P,
      resolution,
      durationSeconds,
      pointsPerSecond: VIDEO_CREDITS_PER_SECOND_720P,
    };
  }
  return {
    ok: false,
    code: VIDEO_CREDIT_PRICE_NOT_CONFIGURED,
    error: "当前分辨率暂未配置积分价格，无法生成",
    resolution,
    durationSeconds,
  };
}

/** Frontend estimate helper — mirrors server quote for 480P/720P. */
export function estimateStoryboardVideoCredits(input: {
  resolution: VideoResolution | string;
  durationSeconds: number;
}): number | null {
  const quote = quoteStoryboardVideoCredits(input);
  return quote.ok ? quote.points : null;
}
