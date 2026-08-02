import type { VideoAspectRatio, VideoResolution } from "@/video-generation/types";

export const STORYBOARD_VIDEO_ASPECT_RATIO: VideoAspectRatio = "16:9";
export const STORYBOARD_VIDEO_RESOLUTION: VideoResolution = "720P";
/** 受控并发：避免无控制 Promise.all 打满 Provider */
export const STORYBOARD_VIDEO_CONCURRENCY = 2;

export function estimateStoryboardVideoCredits(
  durationSeconds: number,
): number {
  return Math.max(1, Math.round(durationSeconds * 10));
}
