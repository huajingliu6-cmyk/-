import { describe, expect, it } from "vitest";
import {
  defaultPersonalVideoOutputParams,
  modelChoiceFromProviderModelId,
  providerModelIdForPersonalVideoChoice,
  resolvePersonalVideoOutputParams,
} from "@/personal/video-generation/personal-video-params";

describe("personal video output params", () => {
  it("uses storyboard defaults when form fields are missing", () => {
    const params = resolvePersonalVideoOutputParams(new FormData());
    expect(params).toEqual(defaultPersonalVideoOutputParams());
  });

  it("parses model, resolution, aspect ratio, duration and style from form", () => {
    const form = new FormData();
    form.set("videoModelChoice", "seedance-2.0-fast");
    form.set("resolution", "1080P");
    form.set("aspectRatio", "9:16");
    form.set("durationSeconds", "12");
    form.set("stylePreset", "cinematic");

    expect(resolvePersonalVideoOutputParams(form)).toEqual({
      modelChoice: "seedance-2.0-fast",
      resolution: "1080P",
      aspectRatio: "9:16",
      durationSeconds: 12,
      stylePreset: "cinematic",
    });
  });

  it("maps model choice to provider model id and back", () => {
    const providerModelId = providerModelIdForPersonalVideoChoice(
      "seedance-2.0-mini",
    );
    expect(providerModelId).toBe("doubao-seedance-2.0-mini");
    expect(modelChoiceFromProviderModelId(providerModelId)).toBe(
      "seedance-2.0-mini",
    );
  });
});
