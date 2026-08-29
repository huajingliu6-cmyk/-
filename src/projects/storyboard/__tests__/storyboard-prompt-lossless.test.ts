import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  extractShotDialogue,
  generateStructuredStoryboard,
  splitShots,
} from "@/projects/storyboard/services/storyboard-generate";
import { fillShotVideoPromptsWithLlm } from "@/projects/storyboard/services/storyboard-prompt-llm";
import { buildStoryboardClipBatchUserPrompt } from "@/projects/storyboard/services/storyboard-prompt-contract";
import {
  isStoryboardPromptRuleExpired,
  unlockAllAutoStoryboardPrompts,
} from "@/projects/storyboard/services/storyboard-prompt-validation";
import {
  STORYBOARD_PROMPT_RULE_VERSION,
  STORYBOARD_SHOT_DURATION_MIN,
} from "@/projects/storyboard/storyboard-video-params";
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

const assetMatches: AssetMatchItem[] = [];

function mockHttp() {
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
      provider: "http",
      apiUrl: "https://example.com/v1",
      apiKey: "sk-test",
      model: "qwen-plus",
      enabled: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    secret: "sk-test",
  });
}

describe("storyboard prompt lossless + dialogue acceptance", () => {
  it("covers every line in sourceScriptText when scene has >4 lines", () => {
    const lines = [
      "场景：别墅客厅",
      "韩兆丰坐在沙发上。",
      "红裙女人走进门。",
      "电视屏幕闪烁。",
      "窗外雨声淅沥。",
      "门厅传来脚步声。",
      "韩兆丰抬起头。",
    ];
    const snippets = splitShots(lines.join("\n"));
    // One scene → one shot; platform does not invent intra-scene splits.
    expect(snippets).toHaveLength(1);
    const joined = snippets.join("\n");
    for (const line of lines.slice(1)) {
      expect(joined).toContain(line);
    }

    const doc = generateStructuredStoryboard({
      scriptText: lines.join("\n"),
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const allSource = doc.scenes
      .flatMap((s) => s.shots)
      .map((s) => s.sourceScriptText || "")
      .join("\n");
    for (const line of lines.slice(1)) {
      expect(allSource).toContain(line);
    }
    expect(doc.scenes.reduce((n, s) => n + s.shots.length, 0)).toBe(1);
  });

  it('parses “韩兆丰：来了，怎么不出声？” verbatim into dialogue', () => {
    expect(extractShotDialogue("韩兆丰：来了，怎么不出声？")).toBe(
      "来了，怎么不出声？",
    );
    const doc = generateStructuredStoryboard({
      scriptText: "场景：门外\n韩兆丰：来了，怎么不出声？",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const hit = doc.scenes
      .flatMap((s) => s.shots)
      .find((s) => (s.sourceScriptText || "").includes("韩兆丰"));
    expect(hit?.dialogue).toBe("来了，怎么不出声？");
  });

  it('model request for “红裙女人：不要走。” must not say 原始对白：无', () => {
    const prompt = buildStoryboardClipBatchUserPrompt({
      targets: [
        {
          shotId: "shot_1",
          shotNumber: 1,
          sceneTitle: "客厅",
          dialogue: "不要走。",
          visualDescription: "红裙女人：不要走。".slice(0, 10),
          actionDescription: "红裙女人：不要走。".slice(0, 8),
          requiredCharacters: ["红裙女人"],
          characterAssetIds: [],
          sourceScriptText: "红裙女人：不要走。",
        },
      ],
    });
    expect(prompt).toContain("当前镜头原文");
    expect(prompt).toContain("红裙女人：不要走。");
    expect(prompt).toContain("原始对白: 不要走。");
    expect(prompt).not.toContain("原始对白: 无");
    expect(prompt).not.toContain("原始对白: （本镜无对白）");
  });

  it("keeps text beyond 120 chars in sourceScriptText", () => {
    const long =
      "甲".repeat(80) +
      "后半段关键剧情：保险箱被打开，文件散落一地，韩兆丰脸色骤变。" +
      "乙".repeat(40);
    expect(long.length).toBeGreaterThan(120);
    const doc = generateStructuredStoryboard({
      scriptText: `场景：书房\n${long}`,
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = doc.scenes.flatMap((s) => s.shots).find((s) =>
      (s.sourceScriptText || "").includes("后半段关键剧情"),
    );
    expect(shot).toBeTruthy();
    expect(shot!.sourceScriptText).toContain("后半段关键剧情");
    expect(shot!.visualDescription.length).toBeLessThanOrEqual(120);
    expect(shot!.durationSeconds).toBe(STORYBOARD_SHOT_DURATION_MIN);
  });

  it("supports additional dialogue formats", () => {
    expect(extractShotDialogue("红裙女人: 不要走。")).toBe("不要走。");
    expect(extractShotDialogue("红裙女人：「不要走。」")).toBe("不要走。");
    expect(extractShotDialogue("韩兆丰说：“来了。”")).toBe("来了。");
    expect(extractShotDialogue("韩兆丰道：「来了。」")).toBe("来了。");
    expect(
      extractShotDialogue("韩兆丰：\n来了，怎么不出声？"),
    ).toBe("来了，怎么不出声？");
  });

  it("packs a long script into one shot per scene without dropping lines", () => {
    const bodyLines = Array.from(
      { length: 40 },
      (_, i) => `剧情行${i + 1}：发生了事情。`,
    );
    const script = ["场景：长戏", ...bodyLines].join("\n");
    const doc = generateStructuredStoryboard({
      scriptText: script,
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shots = doc.scenes.flatMap((s) => s.shots);
    expect(shots.length).toBe(1);
    const allSource = shots.map((s) => s.sourceScriptText || "").join("\n");
    for (const line of bodyLines) {
      expect(allSource).toContain(line);
    }
  });
});

describe("auto promptLocked regeneration after rule change", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-sb-regen-"));
    process.env.APP_DATA_DIR = tmp;
    streamTextMock.mockReset();
    mockHttp();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("regenerates expired auto-locked prompts on fill", async () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：客厅\n韩兆丰：来了，怎么不出声？\n红裙女人：不要走。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });

    // Simulate old auto-locked prompts under previous rule version.
    for (const scene of board.scenes) {
      for (const shot of scene.shots) {
        shot.promptLocked = true;
        shot.promptOrigin = "auto";
        shot.storyboardPromptRuleVersion = "V5-13S-R2";
        shot.videoPrompt = "【时间轴·强制映射】旧正文";
        shot.promptDraft = shot.videoPrompt;
      }
    }
    expect(isStoryboardPromptRuleExpired(board.scenes[0]!.shots[0]!)).toBe(
      true,
    );

    let callCount = 0;
    streamTextMock.mockImplementation(async function* (request: {
      userPrompt?: string;
    }) {
      callCount += 1;
      const prompt = String(request?.userPrompt ?? "");
      expect(prompt).toContain("当前镜头原文");
      expect(prompt).not.toContain("原始对白: 无");
      const shotIds = [...prompt.matchAll(/shotId:\s*(\S+)/g)].map(
        (m) => m[1]!,
      );
      yield {
        type: "delta",
        text: JSON.stringify({
          shots: shotIds.map((shotId) => ({
            shotId,
            videoPrompt: `新生成-${shotId}`,
          })),
        }),
      };
    });

    const filled = await fillShotVideoPromptsWithLlm({
      projectId: "p1",
      userId: "u1",
      storyboard: board,
      forceRegenerateAuto: true,
    });

    expect(callCount).toBeGreaterThan(0);
    expect(filled.generatedCount).toBeGreaterThan(0);
    for (const scene of filled.storyboard.scenes) {
      for (const shot of scene.shots) {
        expect(shot.videoPrompt.startsWith("新生成-")).toBe(true);
        expect(shot.storyboardPromptRuleVersion).toBe(
          STORYBOARD_PROMPT_RULE_VERSION,
        );
        expect(shot.videoPrompt).not.toContain("【时间轴·强制映射】");
      }
    }

    // Manual lock must survive unlockAllAuto
    const manual = structuredClone(filled.storyboard);
    const target = manual.scenes[0]!.shots[0]!;
    target.promptOrigin = "manual";
    target.promptLocked = true;
    target.videoPrompt = "用户手改正文";
    const unlocked = unlockAllAutoStoryboardPrompts(manual);
    expect(unlocked.scenes[0]!.shots[0]!.videoPrompt).toBe("用户手改正文");
    expect(unlocked.scenes[0]!.shots[0]!.promptLocked).toBe(true);
  });
});
