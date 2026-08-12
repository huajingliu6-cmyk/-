import type { VideoAspectRatio, VideoResolution } from "@/video-generation/types";
import { estimateStoryboardVideoCredits as estimateVideoCreditsFromPricing } from "@/credits/generation-pricing";

export const STORYBOARD_VIDEO_ASPECT_RATIO: VideoAspectRatio = "16:9";
export const STORYBOARD_VIDEO_RESOLUTION: VideoResolution = "720P";
/** 受控并发：避免无控制 Promise.all 打满 Provider */
export const STORYBOARD_VIDEO_CONCURRENCY = 2;

/**
 * 前端预计费用（仅展示）。服务端会按分辨率/时长重新计价。
 * 1080P 等未配置价格时返回 null。
 */
export function estimateStoryboardVideoCredits(
  durationSeconds: number,
  resolution: VideoResolution | string = STORYBOARD_VIDEO_RESOLUTION,
): number | null {
  return estimateVideoCreditsFromPricing({
    resolution,
    durationSeconds,
  });
}
