import { describe, expect, it } from "vitest";
import {
  isPersonalImageCount,
  isPersonalImageResolution,
  personalResolutionToQuality,
} from "@/personal/image-generation/constants";
import { extractMediaIdFromImageUrl } from "@/personal/image-generation/generate-personal-image";

describe("personal image generation constants", () => {
  it("maps resolution tiers to provider quality", () => {
    expect(personalResolutionToQuality("1K")).toBe("low");
    expect(personalResolutionToQuality("2K")).toBe("medium");
    expect(personalResolutionToQuality("4K")).toBe("high");
  });

  it("validates resolution and count", () => {
    expect(isPersonalImageResolution("1K")).toBe(true);
    expect(isPersonalImageResolution("8K")).toBe(false);
    expect(isPersonalImageCount(3)).toBe(true);
    expect(isPersonalImageCount(4)).toBe(false);
  });
});

describe("extractMediaIdFromImageUrl", () => {
  it("reads material media id from image url", () => {
    expect(
      extractMediaIdFromImageUrl("/api/materials/media/abc123"),
    ).toBe("abc123");
  });
});
