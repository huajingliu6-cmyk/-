import { describe, expect, it } from "vitest";
import { generateStructuredStoryboard } from "@/projects/storyboard/services/storyboard-generate";
import {
  formatStoryboardPromptValidationError,
  isStoryboardPromptRuleExpired,
  parseTimelineSegments,
  validateGeneratedStoryboardPrompts,
  validateShotPrompt,
  validateShotPromptPartitioned,
} from "@/projects/storyboard/services/storyboard-prompt-validation";
import {
  STORYBOARD_PROMPT_RULE_VERSION,
  STORYBOARD_SHOT_DURATION_MAX,
  STORYBOARD_SHOT_DURATION_MIN,
} from "@/projects/storyboard/storyboard-video-params";
import type { StoryboardShot } from "@/projects/storyboard/types";

function ruleShapedPrompt(input: {
  total: 13 | 14 | 15;
  timeline: string[];
  characterAssetIds?: string[];
  requiredCharacters?: string[];
}): string {
  const total = input.total;
  return [
    `【Clip 001｜场景：雨夜｜镜头：001｜总时长：${total}秒｜节奏：紧张】`,
    "挂载：@人物【图:c1:林清】-林清",
    "人物站位：林清居中。",
    ...input.timeline,
    "连续性：保持服装一致。",
  ].join("\n");
}

function baseShot(): StoryboardShot {
  const board = generateStructuredStoryboard({
    scriptText: "场景：雨夜\n林清走来。",
    assetMatches: [],
    sourceScriptHash: "h1",
    sourceAssetSnapshotHash: "h2",
    userId: "u1",
  });
  const shot = board.scenes[0]!.shots[0]!;
  shot.characterAssetIds = ["c1"];
  shot.requiredCharacters = ["林清"];
  return shot;
}

describe("storyboard prompt validation", () => {
  it("rejects placeholder templates and generic character names", () => {
    const shot = baseShot();
    shot.videoPrompt = [
      "景别：中景。",
      "镜头角度：平视。",
      "运镜：固定。",
      "人物：主要人物。",
      "动作与画面：林清走来。",
    ].join("\n");

    const issues = validateShotPrompt(shot);
    expect(issues.some((issue) => issue.code === "GENERIC_CHARACTER_PLACEHOLDER")).toBe(
      true,
    );
    expect(issues.some((issue) => issue.code === "PLACEHOLDER_TEMPLATE")).toBe(true);
    expect(formatStoryboardPromptValidationError(issues)).toContain("主要人物");
  });

  it.each([13, 14, 15] as const)("accepts %s second Clip prompts", (total) => {
    const shot = baseShot();
    const timelines: Record<13 | 14 | 15, string[]> = {
      13: [
        "0—3秒｜中景：开场。",
        "3—6秒｜近景：推进。",
        "6—9秒｜特写：反应。",
        "9—13秒｜近景：收尾。",
      ],
      14: [
        "0—4秒｜中景：开场。",
        "4—8秒｜近景：推进。",
        "8—12秒｜特写：反应。",
        "12—14秒｜近景：收尾。",
      ],
      15: [
        "0—3秒｜中景：开场。",
        "3—6秒｜近景：推进。",
        "6—9秒｜特写：反应。",
        "9—12秒｜近景：对白。",
        "12—15秒｜特写：收尾。",
      ],
    };
    shot.videoPrompt = ruleShapedPrompt({
      total,
      timeline: timelines[total],
    });
    expect(validateShotPrompt(shot)).toEqual([]);
  });

  it("rejects 12 second Clip prompts", () => {
    const shot = baseShot();
    shot.videoPrompt = [
      "【Clip 001｜场景：雨夜｜镜头：001｜总时长：12秒｜节奏：紧张】",
      "挂载：@人物【图:c1:林清】-林清",
      "人物站位：林清居中。",
      "0—12秒｜中景：整段。",
      "连续性：保持服装一致。",
    ].join("\n");
    const issues = validateShotPrompt(shot);
    expect(
      issues.some(
        (issue) =>
          issue.code === "INVALID_CLIP_DURATION" ||
          issue.code === "MISSING_CLIP_DURATION",
      ),
    ).toBe(true);
  });

  it("rejects 16 second Clip prompts", () => {
    const shot = baseShot();
    shot.videoPrompt = [
      "【Clip 001｜场景：雨夜｜镜头：001｜总时长：16秒｜节奏：紧张】",
      "挂载：@人物【图:c1:林清】-林清",
      "人物站位：林清居中。",
      "0—16秒｜中景：整段。",
      "连续性：保持服装一致。",
    ].join("\n");
    const issues = validateShotPrompt(shot);
    expect(
      issues.some(
        (issue) =>
          issue.code === "INVALID_CLIP_DURATION" ||
          issue.code === "MISSING_CLIP_DURATION" ||
          issue.code === "INTERNAL_SHOT_TOO_LONG",
      ),
    ).toBe(true);
  });

  it("accepts continuous timeline 0-4, 4-8, 8-14 for 14 second Clip", () => {
    const shot = baseShot();
    shot.videoPrompt = ruleShapedPrompt({
      total: 14,
      timeline: [
        "0—4秒｜中景：开场。",
        "4—8秒｜近景：推进。",
        "8—12秒｜特写：反应。",
        "12—14秒｜近景：收尾。",
      ],
    });
    expect(parseTimelineSegments(shot.videoPrompt)).toHaveLength(4);
    expect(validateShotPrompt(shot)).toEqual([]);
  });

  it("flags soft timeline structure issues without treating them as hard blockers", () => {
    const shot = baseShot();
    shot.videoPrompt = ruleShapedPrompt({
      total: 14,
      timeline: [
        "1—5秒｜中景：开场。",
        "5—9秒｜近景：推进。",
        "9—14秒｜近景：收尾。",
      ],
    });
    const { errors, warnings } = validateShotPromptPartitioned(shot);
    expect(errors).toEqual([]);
    expect(warnings.some((issue) => issue.code === "TIMELINE_NOT_FROM_ZERO")).toBe(
      true,
    );
  });

  it("keeps invalid clip duration as a hard error", () => {
    const shot = baseShot();
    shot.videoPrompt = [
      "【Clip 001｜场景：雨夜｜镜头：001｜总时长：12秒｜节奏：紧张】",
      "挂载：@人物【图:c1:林清】-林清",
      "人物站位：林清居中。",
      "0—4秒｜中景：开场。",
      "4—8秒｜近景：推进。",
      "8—12秒｜近景：收尾。",
      "连续性：保持服装一致。",
    ].join("\n");
    const { errors } = validateShotPromptPartitioned(shot);
    expect(
      errors.some(
        (issue) =>
          issue.code === "INVALID_CLIP_DURATION" ||
          issue.code === "MISSING_CLIP_DURATION",
      ),
    ).toBe(true);
  });

  it("soft-warns when required character name is missing from prompt text", () => {
    const shot = baseShot();
    shot.requiredCharacters = ["韩兆丰"];
    shot.characterAssetIds = [];
    shot.videoPrompt = ruleShapedPrompt({
      total: 14,
      timeline: [
        "0—4秒｜中景：开场。",
        "4—8秒｜近景：推进。",
        "8—12秒｜特写：反应。",
        "12—14秒｜近景：收尾。",
      ],
    }).replace(/林清/g, "路人");
    const { errors, warnings } = validateShotPromptPartitioned(shot);
    expect(errors).toEqual([]);
    expect(
      warnings.some((issue) => issue.code === "MISSING_REQUIRED_CHARACTER"),
    ).toBe(true);
  });

  it("rejects timeline starting at 1 second", () => {
    const shot = baseShot();
    shot.videoPrompt = ruleShapedPrompt({
      total: 14,
      timeline: ["1—5秒｜中景：开场。", "5—14秒｜近景：收尾。"],
    });
    const issues = validateShotPrompt(shot);
    expect(issues.some((issue) => issue.code === "TIMELINE_NOT_FROM_ZERO")).toBe(
      true,
    );
  });

  it("rejects overlapping timeline 0-5 and 4-14", () => {
    const shot = baseShot();
    shot.videoPrompt = ruleShapedPrompt({
      total: 14,
      timeline: ["0—5秒｜中景：开场。", "4—14秒｜近景：收尾。"],
    });
    const issues = validateShotPrompt(shot);
    expect(issues.some((issue) => issue.code === "TIMELINE_OVERLAP")).toBe(true);
  });

  it("rejects timeline ending before Clip total duration", () => {
    const shot = baseShot();
    shot.videoPrompt = ruleShapedPrompt({
      total: 14,
      timeline: ["0—4秒｜中景：开场。", "4—12秒｜近景：收尾。"],
    });
    const issues = validateShotPrompt(shot);
    expect(issues.some((issue) => issue.code === "TIMELINE_END_MISMATCH")).toBe(
      true,
    );
  });

  it("rejects internal segment longer than 6 seconds", () => {
    const shot = baseShot();
    shot.videoPrompt = ruleShapedPrompt({
      total: 14,
      timeline: ["0—7秒｜中景：过长。", "7—11秒｜近景：推进。", "11—14秒｜近景：收尾。"],
    });
    const issues = validateShotPrompt(shot);
    expect(issues.some((issue) => issue.code === "INTERNAL_SHOT_TOO_LONG")).toBe(
      true,
    );
  });

  it("rejects fewer than 3 internal segments for 14 second Clip", () => {
    const shot = baseShot();
    shot.videoPrompt = ruleShapedPrompt({
      total: 14,
      timeline: ["0—7秒｜中景：开场。", "7—14秒｜近景：收尾。"],
    });
    const issues = validateShotPrompt(shot);
    expect(
      issues.some(
        (issue) =>
          issue.code === "TOO_FEW_INTERNAL_SHOTS" ||
          issue.code === "INTERNAL_SHOT_TOO_LONG",
      ),
    ).toBe(true);
  });

  it("accepts three internal segments totaling 14 seconds", () => {
    const shot = baseShot();
    shot.videoPrompt = ruleShapedPrompt({
      total: 14,
      timeline: [
        "0—5秒｜中景：开场。",
        "5—10秒｜近景：推进。",
        "10—14秒｜特写：收尾。",
      ],
    });
    expect(validateShotPrompt(shot)).toEqual([]);
  });

  it("accepts internal segment of exactly 4 seconds", () => {
    const shot = baseShot();
    shot.videoPrompt = ruleShapedPrompt({
      total: 14,
      timeline: [
        "0—4秒｜中景：开场。",
        "4—8秒｜近景：推进。",
        "8—12秒｜特写：反应。",
        "12—14秒｜近景：收尾。",
      ],
    });
    expect(validateShotPrompt(shot)).toEqual([]);
  });

  it("marks legacy 9 second prompts as expired", () => {
    const shot = baseShot();
    shot.videoPrompt = [
      "[分镜01｜总时长：9秒｜画幅：9:16]",
      "挂载：@人物【图:c1:林清】-林清",
      "人物站位：林清居中。",
      "0—9秒｜中景：林清走来。",
      "连续性：保持服装一致。",
    ].join("\n");
    shot.storyboardPromptRuleVersion = null;
    expect(isStoryboardPromptRuleExpired(shot)).toBe(true);
  });

  it("accepts current rule version with valid 14 second prompt", () => {
    const shot = baseShot();
    shot.videoPrompt = ruleShapedPrompt({
      total: 14,
      timeline: [
        "0—4秒｜中景：开场。",
        "4—8秒｜近景：推进。",
        "8—12秒｜特写：反应。",
        "12—14秒｜近景：收尾。",
      ],
    });
    shot.storyboardPromptRuleVersion = STORYBOARD_PROMPT_RULE_VERSION;
    expect(isStoryboardPromptRuleExpired(shot)).toBe(false);
  });

  it("treats prior V5-13S rule version as still compatible", () => {
    const shot = baseShot();
    shot.videoPrompt = ruleShapedPrompt({
      total: 14,
      timeline: [
        "0—4秒｜中景：开场。",
        "4—8秒｜近景：推进。",
        "8—12秒｜特写：反应。",
        "12—14秒｜近景：收尾。",
      ],
    });
    shot.storyboardPromptRuleVersion = "V5-13S";
    expect(isStoryboardPromptRuleExpired(shot)).toBe(false);
  });

  it("validateGeneratedStoryboardPrompts batches target shots", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    shot.videoPrompt = "无效";
    const issues = validateGeneratedStoryboardPrompts({
      storyboard: board,
      targetShotIds: [shot.id],
    });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("documents clip duration bounds", () => {
    expect(STORYBOARD_SHOT_DURATION_MIN).toBe(13);
    expect(STORYBOARD_SHOT_DURATION_MAX).toBe(15);
  });
});
