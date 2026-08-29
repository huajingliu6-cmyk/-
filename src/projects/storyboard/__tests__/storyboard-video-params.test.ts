import { describe, expect, it } from "vitest";
import {
  clampStoryboardClipDuration,
  clampStoryboardVideoDuration,
  estimateCreditsForStoryboardVideoOutput,
  isValidStoryboardClipDuration,
  parseDurationSecondsFromVideoPrompt,
  parseStoryboardClipDurationSeconds,
  parseStoryboardVideoAspectRatio,
  parseStoryboardVideoDurationSeconds,
  parseStoryboardVideoResolution,
  resolveStoryboardVideoOutputParams,
  STORYBOARD_SHOT_DURATION_MAX,
  STORYBOARD_SHOT_DURATION_MIN,
  STORYBOARD_VIDEO_DURATION_MAX,
  STORYBOARD_VIDEO_DURATION_MIN,
} from "@/projects/storyboard/storyboard-video-params";

describe("storyboard video output params", () => {
  it("通用视频出参时长仍为 5–15 秒", () => {
    expect(STORYBOARD_VIDEO_DURATION_MIN).toBe(5);
    expect(STORYBOARD_VIDEO_DURATION_MAX).toBe(15);
    expect(parseStoryboardVideoResolution("720p")).toBe("720P");
    expect(parseStoryboardVideoResolution("4k")).toBeNull();
    expect(parseStoryboardVideoAspectRatio("9:16")).toBe("9:16");
    expect(parseStoryboardVideoAspectRatio("1:1")).toBeNull();
    expect(parseStoryboardVideoDurationSeconds(7.4)).toBe(7);
    expect(parseStoryboardVideoDurationSeconds(3)).toBeNull();
    expect(parseStoryboardVideoDurationSeconds(20)).toBeNull();
    expect(clampStoryboardVideoDuration(3)).toBe(5);
    expect(clampStoryboardVideoDuration(20)).toBe(15);
    expect(clampStoryboardVideoDuration(12)).toBe(12);
  });

  it("分镜 Clip 时长仅允许 13、14、15 秒", () => {
    expect(isValidStoryboardClipDuration(13)).toBe(true);
    expect(isValidStoryboardClipDuration(14)).toBe(true);
    expect(isValidStoryboardClipDuration(15)).toBe(true);
    expect(isValidStoryboardClipDuration(12)).toBe(false);
    expect(isValidStoryboardClipDuration(16)).toBe(false);
    expect(parseStoryboardClipDurationSeconds(14)).toBe(14);
    expect(parseStoryboardClipDurationSeconds(12)).toBeNull();
    expect(clampStoryboardClipDuration(12)).toBe(13);
    expect(clampStoryboardClipDuration(20)).toBe(15);
  });

  it("从 videoPrompt 头解析 Clip / 分镜总时长（仅 13–15 合法）", () => {
    expect(
      parseDurationSecondsFromVideoPrompt(
        "【Clip 001｜场景：客厅｜镜头：001｜总时长：14秒｜节奏：紧张】\n场景基调：雨夜。",
      ),
    ).toBe(14);
    expect(
      parseDurationSecondsFromVideoPrompt(
        "[分镜01｜总时长：14秒｜画幅：9:16]\n0—14秒｜中景。",
      ),
    ).toBe(14);
    expect(parseDurationSecondsFromVideoPrompt("没有时长头")).toBeNull();
    expect(
      parseDurationSecondsFromVideoPrompt(
        "[分镜01｜总时长：12秒｜画幅：9:16]",
      ),
    ).toBeNull();
    expect(
      parseDurationSecondsFromVideoPrompt(
        "[分镜01｜总时长：9秒｜画幅：9:16]",
      ),
    ).toBeNull();
    expect(
      parseDurationSecondsFromVideoPrompt(
        "[分镜01｜总时长：16秒｜画幅：9:16]",
      ),
    ).toBeNull();
  });

  it("从 body 解析分镜出站参数并允许 5–15 秒时长", () => {
    const parsed = resolveStoryboardVideoOutputParams(
      {
        resolution: "1080P",
        aspectRatio: "9:16",
        durationSeconds: 14,
      },
      3,
    );
    expect(parsed).toEqual({
      resolution: "1080P",
      aspectRatio: "9:16",
      durationSeconds: 14,
      modelChoice: "seedance-2.0",
      stylePreset: "",
    });

    const fallback = resolveStoryboardVideoOutputParams({}, 5);
    expect(fallback.resolution).toBe("720P");
    expect(fallback.aspectRatio).toBe("9:16");
    expect(fallback.durationSeconds).toBe(5);
    expect(fallback.modelChoice).toBe("seedance-2.0");

    const midRange = resolveStoryboardVideoOutputParams(
      { durationSeconds: 9 },
      14,
    );
    expect(midRange.durationSeconds).toBe(9);

    const invalidBody = resolveStoryboardVideoOutputParams(
      { durationSeconds: 20 },
      8,
    );
    expect(invalidBody.durationSeconds).toBe(8);

    const withChoice = resolveStoryboardVideoOutputParams(
      {
        videoModelChoice: "seedance-2.0-fast",
        stylePreset: "cinematic",
      },
      15,
    );
    expect(withChoice.modelChoice).toBe("seedance-2.0-fast");
    expect(withChoice.stylePreset).toBe("cinematic");
    expect(withChoice.durationSeconds).toBe(15);
  });

  it("estimates credits from output params", () => {
    expect(
      estimateCreditsForStoryboardVideoOutput({
        resolution: "480P",
        durationSeconds: 13,
      }),
    ).toBe(65);
    expect(
      estimateCreditsForStoryboardVideoOutput({
        resolution: "720P",
        durationSeconds: 14,
      }),
    ).toBe(140);
    expect(
      estimateCreditsForStoryboardVideoOutput({
        resolution: "1080P",
        durationSeconds: 15,
      }),
    ).toBeNull();
  });
});
