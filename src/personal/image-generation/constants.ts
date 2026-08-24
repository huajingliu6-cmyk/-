import { materialMediaUrl } from "@/materials/constants";
import {
  DESIGN_IMAGE_ASPECT_RATIOS,
  type DesignImageQuality,
} from "@/projects/assets/episode-design/image-generation-options";
import type {
  PersonalImageCount,
  PersonalImageResolution,
} from "@/personal/image-generation/types";

export const PERSONAL_IMAGE_NAMESPACE = "personal-image-history";

export const PERSONAL_IMAGE_HISTORY_PAGE_SIZE = 20;

export const PERSONAL_IMAGE_MAX_REFERENCES = 6;

export const PERSONAL_IMAGE_ASPECT_RATIOS = DESIGN_IMAGE_ASPECT_RATIOS;

export const PERSONAL_IMAGE_RESOLUTIONS: PersonalImageResolution[] = [
  "1K",
  "2K",
  "4K",
];

export const PERSONAL_IMAGE_COUNTS: PersonalImageCount[] = [1, 2, 3];

export function personalImageMediaUrl(mediaId: string): string {
  return materialMediaUrl(mediaId);
}

export function isPersonalImageResolution(
  value: unknown,
): value is PersonalImageResolution {
  return value === "1K" || value === "2K" || value === "4K";
}

export function isPersonalImageCount(value: unknown): value is PersonalImageCount {
  return value === 1 || value === 2 || value === 3;
}

export function personalResolutionToQuality(
  resolution: PersonalImageResolution,
): DesignImageQuality {
  if (resolution === "2K") return "medium";
  if (resolution === "4K") return "high";
  return "low";
}

/** CSS aspect-ratio value from stored ratio label like `16:9`. */
export function personalAspectRatioToCss(ratio: string): string {
  const normalized = ratio.trim().replace("/", ":");
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(normalized);
  if (!match) return "16 / 9";
  return `${match[1]} / ${match[2]}`;
}
