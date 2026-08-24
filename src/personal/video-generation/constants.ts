export const PERSONAL_VIDEO_NAMESPACE = "personal-video-history";

export const PERSONAL_VIDEO_DURATION_MIN = 5;
export const PERSONAL_VIDEO_DURATION_MAX = 15;
export const PERSONAL_VIDEO_DEFAULT_DURATION = 5;

export const PERSONAL_VIDEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;

export type PersonalVideoAspectRatio =
  (typeof PERSONAL_VIDEO_ASPECT_RATIOS)[number];

export const PERSONAL_VIDEO_RESOLUTION = "720P" as const;

export const PERSONAL_VIDEO_HISTORY_LIMITS: Record<
  PersonalVideoAspectRatio,
  number
> = {
  "16:9": 6,
  "9:16": 10,
};
