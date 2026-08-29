import { describe, expect, it } from "vitest";
import {
  buildModelPlanBatchUserPrompt,
  buildStoryboardFromModelShots,
  parseModelStoryboardBatch,
  STORYBOARD_MODEL_SHOT_BATCH_SIZE,
} from "@/projects/storyboard/services/storyboard-model-plan";
import { buildImmutableOutputContract } from "@/ai-config/output-contracts";
import { getBuiltinTaskRule } from "@/ai-config/builtin-task-rules";

describe("storyboard-model-plan", () => {
  it("platform prompts forbid compressing videoPrompt bodies", () => {
    const user = buildModelPlanBatchUserPrompt({
      scriptText: "甲：你好。",
      completedCount: 0,
      previousEndingSummary: "",
    });
    expect(user).toContain("禁止压缩");
    expect(user).toContain("完整未压缩提示词正文");
    expect(user).not.toContain("压缩上下文");

    const contract = buildImmutableOutputContract(
      "text.storyboard-prompt.generate",
    );
    expect(contract).toMatch(/Do NOT compress/i);
    expect(contract).toContain("完整未压缩正文");

    const builtin = getBuiltinTaskRule("text.storyboard-prompt.generate");
    expect(builtin).toContain("禁止压缩");
    expect(builtin).not.toContain("上下文压缩后继续");
  });

  it("parses up to 3 model shots and done flag", () => {
    const raw = JSON.stringify({
      shots: [
        {
          sceneTitle: "客厅",
          sourceScriptText: "韩兆丰：来了。",
          videoPrompt: "镜1正文",
          dialogue: "来了。",
        },
        {
          sceneTitle: "客厅",
          sourceScriptText: "红裙女人：不要走。",
          videoPrompt: "镜2正文",
        },
        {
          sceneTitle: "门外",
          sourceScriptText: "门关上。",
          videoPrompt: "镜3正文",
        },
        {
          sceneTitle: "多余",
          sourceScriptText: "不应落入本批",
          videoPrompt: "镜4正文",
        },
      ],
      done: false,
    });
    const parsed = parseModelStoryboardBatch(raw);
    expect(parsed.shots).toHaveLength(STORYBOARD_MODEL_SHOT_BATCH_SIZE);
    expect(parsed.done).toBe(false);
    expect(parsed.shots[0]?.videoPrompt).toBe("镜1正文");
    expect(parsed.shots[0]?.dialogue).toBe("来了。");
  });

  it("materializes only model-returned shots (no platform invent)", () => {
    const board = buildStoryboardFromModelShots({
      shots: [
        {
          sceneTitle: "客厅",
          sourceScriptText: "甲线",
          videoPrompt: "提示词甲",
          dialogue: "",
        },
        {
          sceneTitle: "客厅",
          sourceScriptText: "乙线",
          videoPrompt: "提示词乙",
          dialogue: "",
        },
        {
          sceneTitle: "街道",
          sourceScriptText: "丙线",
          videoPrompt: "提示词丙",
          dialogue: "",
        },
      ],
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
    });
    const shots = board.scenes.flatMap((s) => s.shots);
    expect(shots).toHaveLength(3);
    expect(shots.map((s) => s.videoPrompt)).toEqual([
      "提示词甲",
      "提示词乙",
      "提示词丙",
    ]);
    expect(board.scenes).toHaveLength(2);
    expect(shots.map((s) => s.shotNumber)).toEqual([1, 2, 3]);
  });
});
