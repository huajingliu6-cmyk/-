import type { VideoAspectRatio, VideoResolution } from "./types";

export type OutputDimensions = {
  width: number;
  height: number;
};

/**
 * 分辨率 × 五种比例 → 宽*高。
 * 720P / 1080P 对齐万相 2.7 文档；480P 为画布 / HTTP 扩展档位。
 */
const DIMENSION_TABLE: Record<
  VideoResolution,
  Record<VideoAspectRatio, OutputDimensions>
> = {
  "480P": {
    "16:9": { width: 854, height: 480 },
    "9:16": { width: 480, height: 854 },
    "1:1": { width: 640, height: 640 },
    "4:3": { width: 736, height: 552 },
    "3:4": { width: 552, height: 736 },
  },
  "720P": {
    "16:9": { width: 1280, height: 720 },
    "9:16": { width: 720, height: 1280 },
    "1:1": { width: 960, height: 960 },
    "4:3": { width: 1104, height: 832 },
    "3:4": { width: 832, height: 1104 },
  },
  "1080P": {
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
    "1:1": { width: 1440, height: 1440 },
    "4:3": { width: 1648, height: 1248 },
    "3:4": { width: 1248, height: 1648 },
  },
};

export function resolveOutputDimensions(
  resolution: VideoResolution,
  aspectRatio: VideoAspectRatio,
): OutputDimensions {
  return DIMENSION_TABLE[resolution][aspectRatio];
}

export function isVideoResolution(value: string): value is VideoResolution {
  return value === "480P" || value === "720P" || value === "1080P";
}

export function isVideoAspectRatio(value: string): value is VideoAspectRatio {
  return (
    value === "16:9" ||
    value === "9:16" ||
    value === "1:1" ||
    value === "4:3" ||
    value === "3:4"
  );
}
