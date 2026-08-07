import { describe, expect, it } from "vitest";
import {
  clampStoryboardVideoDuration,
  parseDurationSecondsFromVideoPrompt,
  parseStoryboardVideoAspectRatio,
  parseStoryboardVideoDurationSeconds,
  parseStoryboardVideoResolution,
  resolveStoryboardVideoOutputParams,
  STORYBOARD_VIDEO_DURATION_MAX,
  STORYBOARD_VIDEO_DURATION_MIN,
} from "@/projects/storyboard/storyboard-video-params";

describe("storyboard video output params", () => {
  it("视频出参时长仍为 5–15 秒", () => {
    expect(STORYBOARD_VIDEO_DURATION_MIN).toBe(5);
    expect(STORYBOARD_VIDEO_DURATION_MAX).toBe(15);
    expect(parseStoryboardVideoResolution("720p")).toBe("720P");
    expect(parseStoryboardVideoResolution("4k")).toBeNull();
    expect(parseStoryboardVideoAspectRatio("9:16")).toBe("9:16");
    expect(parseStoryboardVideoAspectRatio("1:1")).toBeNull();
    expect(parseStoryboardVideoDurationSeconds(7.4)).toBe(7);
    expect(clampStoryboardVideoDuration(3)).toBe(5);
    expect(clampStoryboardVideoDuration(20)).toBe(15);
    expect(clampStoryboardVideoDuration(12)).toBe(12);
  });

  it("从 videoPrompt 头解析大模型给出的总时长（不向上拉长，仅封顶 15）", () => {
    expect(
      parseDurationSecondsFromVideoPrompt(
        "[分镜01｜总时长：12秒｜画幅：9:16]\n场景基调：雨夜。",
      ),
    ).toBe(12);
    expect(
      parseDurationSecondsFromVideoPrompt(
        "【交接卡】\n\n[分镜03｜总时长：9秒｜画幅：9:16]\n0.0—9.0秒｜近景",
      ),
    ).toBe(9);
    expect(parseDurationSecondsFromVideoPrompt("没有时长头")).toBeNull();
    expect(
      parseDurationSecondsFromVideoPrompt(
        "[分镜01｜总时长：3秒｜画幅：9:16]",
      ),
    ).toBe(3);
    expect(
      parseDurationSecondsFromVideoPrompt(
        "[分镜01｜总时长：20秒｜画幅：9:16]",
      ),
    ).toBe(15);
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

    const fallback = resolveStoryboardVideoOutputParams({}, 5);
    expect(fallback.resolution).toBe("720P");
    expect(fallback.aspectRatio).toBe("16:9");
    expect(fallback.durationSeconds).toBe(5);
  });
});
