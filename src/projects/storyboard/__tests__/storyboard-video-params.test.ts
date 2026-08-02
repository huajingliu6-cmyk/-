import { describe, expect, it } from "vitest";
import {
  clampStoryboardVideoDuration,
  parseStoryboardVideoAspectRatio,
  parseStoryboardVideoDurationSeconds,
  parseStoryboardVideoResolution,
  resolveStoryboardVideoOutputParams,
} from "@/projects/storyboard/storyboard-video-params";

describe("storyboard video output params", () => {
  it("解析画质 / 比例 / 时长", () => {
    expect(parseStoryboardVideoResolution("720p")).toBe("720P");
    expect(parseStoryboardVideoResolution("4k")).toBeNull();
    expect(parseStoryboardVideoAspectRatio("9:16")).toBe("9:16");
    expect(parseStoryboardVideoAspectRatio("1:1")).toBeNull();
    expect(parseStoryboardVideoDurationSeconds(7.4)).toBe(7);
    expect(clampStoryboardVideoDuration(3)).toBe(5);
    expect(clampStoryboardVideoDuration(20)).toBe(15);
  });

  it("从 body 解析并带默认值", () => {
    const parsed = resolveStoryboardVideoOutputParams(
      {
        resolution: "1080P",
        aspectRatio: "9:16",
        durationSeconds: 12,
      },
      3,
    );
    expect(parsed).toEqual({
      resolution: "1080P",
      aspectRatio: "9:16",
      durationSeconds: 12,
    });

    const fallback = resolveStoryboardVideoOutputParams({}, 8);
    expect(fallback.resolution).toBe("720P");
    expect(fallback.aspectRatio).toBe("16:9");
    expect(fallback.durationSeconds).toBe(8);
  });
});
