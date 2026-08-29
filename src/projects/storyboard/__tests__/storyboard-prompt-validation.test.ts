import { describe, expect, it } from "vitest";
import { generateStructuredStoryboard } from "@/projects/storyboard/services/storyboard-generate";
import {
  formatStoryboardPromptValidationError,
  isStoryboardPromptRuleExpired,
  validateShotPrompt,
  validateShotPromptPartitioned,
} from "@/projects/storyboard/services/storyboard-prompt-validation";
import { STORYBOARD_PROMPT_RULE_VERSION } from "@/projects/storyboard/storyboard-video-params";
import type { StoryboardShot } from "@/projects/storyboard/types";

function baseShot(): StoryboardShot {
  const board = generateStructuredStoryboard({
    scriptText: "场景：雨夜\n林清走来。",
    assetMatches: [],
    sourceScriptHash: "h1",
    sourceAssetSnapshotHash: "h2",
    userId: "u1",
  });
  return board.scenes[0]!.shots[0]!;
}

describe("storyboard prompt validation (SHOT_ID_PROMPT_V1)", () => {
  it("only rejects empty prompts", () => {
    const shot = baseShot();
    shot.videoPrompt = "";
    const issues = validateShotPrompt(shot);
    expect(issues).toEqual([
      expect.objectContaining({ code: "EMPTY_PROMPT" }),
    ]);
    expect(formatStoryboardPromptValidationError(issues)).toContain("为空");
  });

  it("accepts free-form rich prompts without timeline or duration checks", () => {
    const shot = baseShot();
    shot.videoPrompt = [
      "【总时长】14秒",
      "【画幅】16:9",
      "【时间轴·强制映射】",
      "0-5秒｜中景：林清进门",
      "【位置结构】林清居左",
      "【连续性锁定】发型不变",
      "【声音设计】雨声",
      "【负面约束】禁止变脸",
      "禁止完全静止画面。",
    ].join("\n");
    expect(validateShotPrompt(shot)).toEqual([]);
  });

  it("accepts short natural-language prompts", () => {
    const shot = baseShot();
    shot.videoPrompt = "雨夜，林清缓步走进仓库，抬头环顾。";
    expect(validateShotPrompt(shot)).toEqual([]);
    expect(validateShotPromptPartitioned(shot)).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it("does not require sound, continuity, blocking, or mounts", () => {
    const shot = baseShot();
    shot.characterAssetIds = ["c1"];
    shot.requiredCharacters = ["林清"];
    shot.videoPrompt = "林清站在雨中。";
    expect(validateShotPrompt(shot)).toEqual([]);
  });

  it("isStoryboardPromptRuleExpired when auto rule version mismatches", () => {
    const shot = baseShot();
    shot.videoPrompt = "任意旧版 V5 正文也可继续用。";
    shot.promptOrigin = "auto";
    shot.promptLocked = true;
    shot.storyboardPromptRuleVersion = null;
    expect(isStoryboardPromptRuleExpired(shot)).toBe(true);

    shot.storyboardPromptRuleVersion = "V5-13S-R2";
    expect(isStoryboardPromptRuleExpired(shot)).toBe(true);

    shot.storyboardPromptRuleVersion = STORYBOARD_PROMPT_RULE_VERSION;
    expect(isStoryboardPromptRuleExpired(shot)).toBe(false);

    shot.promptOrigin = "manual";
    shot.storyboardPromptRuleVersion = "V5-13S-R2";
    expect(isStoryboardPromptRuleExpired(shot)).toBe(false);

    shot.promptOrigin = "auto";
    shot.videoPrompt = "";
    shot.promptDraft = "";
    expect(isStoryboardPromptRuleExpired(shot)).toBe(true);
  });
});
