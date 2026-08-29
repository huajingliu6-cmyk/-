import { describe, expect, it } from "vitest";
import {
  STORYBOARD_SHOT_DURATION_MIN,
  sumStoryboardDurationSeconds,
} from "@/projects/storyboard/storyboard-video-params";
import { generateStructuredStoryboard } from "@/projects/storyboard/services/storyboard-generate";

describe("storyboard duration metadata", () => {
  it("new shots get explicit clip default 13, not silent 5", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。\n她停下。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shots = board.scenes.flatMap((s) => s.shots);
    expect(shots.every((s) => s.durationSeconds === STORYBOARD_SHOT_DURATION_MIN)).toBe(
      true,
    );
    expect(shots.some((s) => s.durationSeconds === 5)).toBe(false);
  });

  it("timeline sum equals sum of shot.durationSeconds", () => {
    const shots = [
      { durationSeconds: 13 },
      { durationSeconds: 14 },
      { durationSeconds: 15 },
    ];
    expect(sumStoryboardDurationSeconds(shots)).toBe(42);
  });

  it("does not invent duration from missing videoPrompt", () => {
    const shots = [{ durationSeconds: 13, videoPrompt: "" }];
    expect(sumStoryboardDurationSeconds(shots)).toBe(13);
  });
});
