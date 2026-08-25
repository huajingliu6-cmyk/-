import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { generateStructuredStoryboard } from "@/projects/storyboard/services/storyboard-generate";
import {
  fillShotVideoPromptsWithLlm,
  parsePromptMap,
  parseRuleNativePromptBlocks,
  regenerateShotVideoPromptWithLlm,
} from "@/projects/storyboard/services/storyboard-prompt-llm";
import { AiConfigError } from "@/ai-config/errors";
import type { AssetMatchItem } from "@/projects/storyboard/types";

vi.mock("@/ai-config/resolve", () => ({
  resolveCapabilityForOutputKind: vi.fn(),
}));

const streamTextMock = vi.fn(async function* () {
  yield { type: "delta", text: "" };
});

vi.mock("@/text-generation/provider/http-compatible-provider", () => ({
  HttpCompatibleTextProvider: vi.fn().mockImplementation(() => ({
    estimateMaxOutputTokens: () => 4096,
    streamText: (...args: unknown[]) => streamTextMock(...args),
  })),
}));

import { resolveCapabilityForOutputKind } from "@/ai-config/resolve";

function mockResolved(provider: "mock" | "http") {
  vi.mocked(resolveCapabilityForOutputKind).mockResolvedValue({
    capability: {
      id: "text.storyboard-prompt.generate",
      label: "分镜提示词生成",
      description: "",
      modality: "text",
      status: "active",
      surface: "StoryboardProductionPanel",
      allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
      requiresCredits: true,
      supportsStreaming: false,
      supportsCancel: false,
      paidRisk: "possible",
      defaultProfileSlot: "storyboard-prompt-text",
      classification: "AI_REQUIRED",
    },
    binding: {
      capabilityId: "text.storyboard-prompt.generate",
      profileSlotId: "storyboard-prompt-text",
      enabled: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "admin",
    },
    profile: {
      id: "storyboard-prompt-text",
      label: "分镜提示词文本模型",
      description: "",
      provider,
      apiUrl: provider === "http" ? "https://example.com/v1" : "",
      apiKey: provider === "http" ? "sk-test" : "",
      model: provider === "http" ? "qwen-plus" : "",
      enabled: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    secret: provider === "http" ? "sk-test" : null,
  });
}

function clipsJsonForShot(input: {
  shotId: string;
  total: 13 | 14 | 15;
}): string {
  const segmentsByTotal: Record<
    13 | 14 | 15,
    Array<{ start: number; end: number }>
  > = {
    13: [
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 9 },
      { start: 9, end: 13 },
    ],
    14: [
      { start: 0, end: 4 },
      { start: 4, end: 8 },
      { start: 8, end: 12 },
      { start: 12, end: 14 },
    ],
    15: [
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 9 },
      { start: 9, end: 12 },
      { start: 12, end: 15 },
    ],
  };
  return JSON.stringify({
    clips: [
      {
        shotId: input.shotId,
        durationSeconds: input.total,
        characterNames: ["林清"],
        characterBlocking: "人物站位：林清居中面向镜头。",
        segments: segmentsByTotal[input.total].map((seg, index) => ({
          ...seg,
          shotSize: "中景",
          cameraAngle: "平视",
          cameraMovement: "固定",
          visualAction: `林清动作${index + 1}`,
          dialogue: "",
          speaker: "",
        })),
        continuity: "保持发型与服装一致。",
        sound: "环境声清晰。",
        negative: "禁止变脸。",
      },
    ],
  });
}

function validClipPrompt(total: 13 | 14 | 15): string {
  const timelines: Record<13 | 14 | 15, string[]> = {
    13: [
      "0—3秒｜中景：林清缓步走来。",
      "3—6秒｜近景：停顿。",
      "6—9秒｜特写：反应。",
      "9—13秒｜近景：保持凝视。",
    ],
    14: [
      "0—4秒｜中景：林清缓步走来。",
      "4—8秒｜近景：停顿。",
      "8—12秒｜特写：反应。",
      "12—14秒｜近景：保持凝视。",
    ],
    15: [
      "0—3秒｜中景：林清缓步走来。",
      "3—6秒｜近景：停顿。",
      "6—9秒｜特写：反应。",
      "9—12秒｜近景：对白。",
      "12—15秒｜特写：保持凝视。",
    ],
  };
  return [
    `【Clip 001｜场景：雨夜｜镜头：001｜总时长：${total}秒｜节奏：紧张】`,
    "挂载：@人物【图:c1:林清】-林清",
    "人物站位：林清居中面向镜头。",
    ...timelines[total],
    "连续性：保持发型与服装一致。",
  ].join("\n");
}

describe("storyboard-prompt-llm", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  const assetMatches: AssetMatchItem[] = [];

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-sb-prompt-"));
    process.env.APP_DATA_DIR = tmp;
    vi.mocked(resolveCapabilityForOutputKind).mockReset();
    streamTextMock.mockReset();
    streamTextMock.mockImplementation(async function* () {
      yield { type: "delta", text: "" };
    });
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("mock provider rejects placeholder templates that fail 13–15s validation", async () => {
    mockResolved("mock");
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜街道\n林清缓步走来。\n\nEXT 仓库\n她停下。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });

    await expect(
      fillShotVideoPromptsWithLlm({
        projectId: "p1",
        userId: "u1",
        storyboard: board,
        salt: "salt-a",
      }),
    ).rejects.toMatchObject({
      code: "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED",
    });

    for (const shot of board.scenes.flatMap((scene) => scene.shots)) {
      expect(shot.promptLocked).toBe(false);
    }
  });

  it("single-shot mock regen rejects placeholder template", async () => {
    mockResolved("mock");
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n人物走过。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    await expect(
      regenerateShotVideoPromptWithLlm({
        projectId: "p1",
        userId: "u1",
        shot,
        sceneTitle: board.scenes[0]!.title,
        salt: "salt-b",
      }),
    ).rejects.toMatchObject({
      code: "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED",
    });
  });

  it("surfaces AiConfigError when capability resolve fails", async () => {
    vi.mocked(resolveCapabilityForOutputKind).mockRejectedValue(
      new AiConfigError(
        "AI_CAPABILITY_NOT_CONFIGURED",
        "该 AI 功能尚未由系统管理员完成配置，请联系管理员。",
      ),
    );
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n人物走过。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    await expect(
      fillShotVideoPromptsWithLlm({
        projectId: "p1",
        userId: "u1",
        storyboard: board,
      }),
    ).rejects.toMatchObject({ code: "AI_CAPABILITY_NOT_CONFIGURED" });
  });

  it("parsePromptMap accepts contract JSON and order fallback", () => {
    const ids = ["shot_a", "shot_b"];
    const expected = new Set(ids);
    const mapped = parsePromptMap(
      JSON.stringify({
        prompts: [
          { shotId: "shot_a", videoPrompt: "提示词甲" },
          { shotId: "shot_b", videoPrompt: "提示词乙" },
        ],
      }),
      expected,
      ids,
    );
    expect(mapped.get("shot_a")).toBe("提示词甲");
    expect(mapped.get("shot_b")).toBe("提示词乙");

    const byOrder = parsePromptMap(
      JSON.stringify({
        prompts: [{ prompt: "按序一" }, { text: "按序二" }],
      }),
      expected,
      ids,
    );
    expect(byOrder.get("shot_a")).toBe("按序一");
    expect(byOrder.get("shot_b")).toBe("按序二");
  });

  it("parsePromptMap accepts rule-native [分镜NN] blocks by order", () => {
    const ids = ["shot_a", "shot_b"];
    const raw = [
      "[分镜01｜总时长：12秒｜画幅：9:16]",
      "场景基调：雨夜茶馆。",
      "0.0—12.0秒｜中景：林清进门。",
      "",
      "【分镜01→分镜02｜交接卡】",
      "交接方式：硬切转场",
      "",
      "[分镜02｜总时长：10秒｜画幅：9:16]",
      "0.0—10.0秒｜近景：对白。",
    ].join("\n");
    expect(parseRuleNativePromptBlocks(raw)).toHaveLength(2);
    const mapped = parsePromptMap(raw, new Set(ids), ids);
    expect(mapped.get("shot_a")).toContain("[分镜01");
    expect(mapped.get("shot_a")).toContain("交接卡");
    expect(mapped.get("shot_b")).toContain("[分镜02");
  });

  it("throws when every pending shot is prompt-locked so LLM is skipped", async () => {
    mockResolved("http");
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜街道\n林清缓步走来。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    for (const scene of board.scenes) {
      for (const shot of scene.shots) {
        shot.promptLocked = true;
      }
    }
    await expect(
      fillShotVideoPromptsWithLlm({
        projectId: "p1",
        userId: "u1",
        storyboard: board,
      }),
    ).rejects.toMatchObject({ code: "STORYBOARD_PROMPTS_NO_TARGETS" });
  });

  it("calls text provider for newly generated unlocked shots", async () => {
    mockResolved("http");
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜街道\n林清缓步走来。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    expect(
      board.scenes.flatMap((scene) => scene.shots).every((shot) => !shot.promptLocked),
    ).toBe(true);

    const targets = board.scenes.flatMap((scene) =>
      scene.shots.map((shot) => ({
        shot,
        prompt: validClipPrompt(14),
      })),
    );
    for (const target of targets) {
      target.shot.characterAssetIds = ["c1"];
      target.shot.requiredCharacters = ["林清"];
    }

    let batchCall = 0;
    streamTextMock.mockImplementation(async function* () {
      const batchSize = 3;
      const start = batchCall * batchSize;
      batchCall += 1;
      const batch = targets.slice(start, start + batchSize);
      yield {
        type: "delta",
        text: JSON.stringify({
          clips: batch.map(({ shot }) => {
            const payload = JSON.parse(
              clipsJsonForShot({ shotId: shot.id, total: 14 }),
            ) as { clips: unknown[] };
            return payload.clips[0];
          }),
        }),
      };
    });

    const filled = await fillShotVideoPromptsWithLlm({
      projectId: "p1",
      userId: "u1",
      storyboard: board,
      context: {
        libraryAssets: {
          characters: [
            {
              id: "c1",
              projectId: "p1",
              name: "林清",
              role: "女主",
              description: "冷静",
              appearance: "黑发",
              clothing: "风衣",
              age: "28",
              gender: "女",
              voiceId: null,
              voiceName: null,
              voiceStyle: null,
              imageFileName: null,
              imageObjectUrl: null,
              imageMimeType: null,
              status: "ready",
              primaryMediaId: "media_c1",
            },
          ],
          scenes: [],
          props: [],
          audios: [],
        },
      },
    });

    expect(streamTextMock).toHaveBeenCalled();
    expect(filled.generatedCount).toBe(targets.length);
    expect(filled.storyboard.scenes[0]?.shots[0]?.promptLocked).toBe(true);
    expect(filled.storyboard.scenes[0]?.shots[0]?.storyboardPromptRuleVersion).toBe(
      "V5-13S-R2",
    );
    expect(filled.storyboard.scenes[0]?.shots[0]?.durationSeconds).toBe(14);
    expect(filled.storyboard.scenes[0]?.shots[0]?.videoPrompt).toContain("【位置结构】");
  });
});
