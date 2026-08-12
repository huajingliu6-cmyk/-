import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN_IMAGE_OPTIONS,
  parseDesignImageGenerationOptions,
} from "@/projects/assets/episode-design/image-generation-options";

describe("design image generation options", () => {
  it("parses valid options", () => {
    expect(
      parseDesignImageGenerationOptions({
        quality: "high",
        aspectRatio: "16:9",
        count: 4,
      }),
    ).toEqual({
      quality: "high",
      aspectRatio: "16:9",
      count: 4,
    });
  });

  it("rejects invalid count and unknown fields", () => {
    expect(
      parseDesignImageGenerationOptions({
        ...DEFAULT_DESIGN_IMAGE_OPTIONS,
        count: 0,
      }),
    ).toBeNull();
    expect(
      parseDesignImageGenerationOptions({
        ...DEFAULT_DESIGN_IMAGE_OPTIONS,
        count: 5,
      }),
    ).toBeNull();
    expect(
      parseDesignImageGenerationOptions({
        quality: "ultra",
        aspectRatio: "16:9",
        count: 1,
      }),
    ).toBeNull();
    expect(
      parseDesignImageGenerationOptions({
        quality: "high",
        aspectRatio: "7:5",
        count: 1,
      }),
    ).toBeNull();
  });
});
