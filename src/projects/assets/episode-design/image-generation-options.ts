export const DESIGN_IMAGE_QUALITIES = ["high", "medium", "low"] as const;

export const DESIGN_IMAGE_ASPECT_RATIOS = [
  "1:1",
  "5:4",
  "9:16",
  "21:9",
  "16:9",
  "4:3",
  "3:2",
  "4:5",
  "3:4",
  "2:3",
] as const;

export const DESIGN_IMAGE_COUNTS = [1, 2, 3, 4] as const;

export type DesignImageQuality = (typeof DESIGN_IMAGE_QUALITIES)[number];
export type DesignImageAspectRatio =
  (typeof DESIGN_IMAGE_ASPECT_RATIOS)[number];
export type DesignImageCount = (typeof DESIGN_IMAGE_COUNTS)[number];

export type DesignImageGenerationOptions = {
  quality: DesignImageQuality;
  aspectRatio: DesignImageAspectRatio;
  count: DesignImageCount;
};

export const DEFAULT_DESIGN_IMAGE_OPTIONS: DesignImageGenerationOptions = {
  quality: "high",
  aspectRatio: "16:9",
  count: 1,
};

export const DESIGN_IMAGE_QUALITY_LABELS: Record<DesignImageQuality, string> = {
  high: "高画质",
  medium: "标准画质",
  low: "基础画质",
};

export const DESIGN_IMAGE_ASPECT_RATIO_LABELS: Record<
  DesignImageAspectRatio,
  string
> = {
  "1:1": "方形 1:1",
  "5:4": "横幅 5:4",
  "9:16": "故事 9:16",
  "21:9": "超宽屏 21:9",
  "16:9": "宽屏 16:9",
  "4:3": "横屏 4:3",
  "3:2": "宽幅 3:2",
  "4:5": "标准 4:5",
  "3:4": "竖版 3:4",
  "2:3": "竖版 2:3",
};

export function isDesignImageQuality(
  value: unknown,
): value is DesignImageQuality {
  return (
    typeof value === "string" &&
    (DESIGN_IMAGE_QUALITIES as readonly string[]).includes(value)
  );
}

export function isDesignImageAspectRatio(
  value: unknown,
): value is DesignImageAspectRatio {
  return (
    typeof value === "string" &&
    (DESIGN_IMAGE_ASPECT_RATIOS as readonly string[]).includes(value)
  );
}

export function isDesignImageCount(value: unknown): value is DesignImageCount {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (DESIGN_IMAGE_COUNTS as readonly number[]).includes(value)
  );
}

/** Strict server parser — returns null when any field is missing/invalid. */
export function parseDesignImageGenerationOptions(
  raw: Record<string, unknown> | null | undefined,
): DesignImageGenerationOptions | null {
  if (!raw) return null;
  const quality = raw.quality;
  const aspectRatio = raw.aspectRatio;
  const count = raw.count;
  if (!isDesignImageQuality(quality)) return null;
  if (!isDesignImageAspectRatio(aspectRatio)) return null;
  if (!isDesignImageCount(count)) return null;
  return { quality, aspectRatio, count };
}

/** Map UI quality tier to provider resolution hint. */
export function designImageQualityToResolution(
  quality: DesignImageQuality,
): "4K" | "2K" | "1K" {
  if (quality === "medium") return "2K";
  if (quality === "low") return "1K";
  return "4K";
}

export function formatDesignImagePreviewTitle(
  options: DesignImageGenerationOptions,
): string {
  return `生成预览 · ${DESIGN_IMAGE_QUALITY_LABELS[options.quality]} · ${options.aspectRatio} · ${options.count}张`;
}
