import { describe, expect, it } from "vitest";
import {
  labelForStoryboardVideoModelChoice,
  parseStoryboardVideoModelChoice,
  providerModelIdForStoryboardVideoModelChoice,
  STORYBOARD_VIDEO_MODEL_CHOICES,
} from "@/projects/storyboard/storyboard-video-model-choices";
import { normalizeArkVideoModelId, normalizeSd2VideoModelId } from "@/video-generation/provider/http-video-dialect";

describe("storyboard video model choices", () => {
  it("exposes Seedance 2.0 / Mini / Fast with stable ids", () => {
    expect(STORYBOARD_VIDEO_MODEL_CHOICES.map((c) => c.id)).toEqual([
      "seedance-2.0",
      "seedance-2.0-mini",
      "seedance-2.0-fast",
    ]);
    expect(labelForStoryboardVideoModelChoice("seedance-2.0-fast")).toBe(
      "Seedance 2.0 Fast",
    );
    expect(parseStoryboardVideoModelChoice("seedance-2.0-mini")).toBe(
      "seedance-2.0-mini",
    );
    expect(parseStoryboardVideoModelChoice("not-a-model")).toBeNull();
  });

  it("maps choice ids to provider model ids that normalize correctly", () => {
    const fast = providerModelIdForStoryboardVideoModelChoice(
      "seedance-2.0-fast",
    );
    expect(normalizeSd2VideoModelId(fast)).toBe("doubao-seedance-2.0-fast");
    expect(normalizeArkVideoModelId("seedace 2.0fast")).toBe(
      "doubao-seedance-2.0-fast",
    );
  });
});
