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

describe("storyboard-prompt-llm", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  const assetMatches: AssetMatchItem[] = [];

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-sb-prompt-"));
    process.env.APP_DATA_DIR = tmp;
    vi.mocked(resolveCapabilityForOutputKind).mockReset();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("mock provider fills unlocked shots with non-empty template prompts", async () => {
    mockResolved("mock");
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜街道\n林清缓步走来。\n\nEXT 仓库\n她停下。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });

    const filled = await fillShotVideoPromptsWithLlm({
      projectId: "p1",
      userId: "u1",
      storyboard: board,
      salt: "salt-a",
    });

    const prompts = filled.storyboard.scenes.flatMap((s) =>
      s.shots.map((sh) => sh.videoPrompt),
    );
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      expect(p.length).toBeGreaterThan(20);
      expect(p).toContain("景别：");
    }
  });

  it("single-shot mock regen returns template prompt", async () => {
    mockResolved("mock");
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n人物走过。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shot = board.scenes[0]!.shots[0]!;
    const prompt = await regenerateShotVideoPromptWithLlm({
      projectId: "p1",
      userId: "u1",
      shot,
      sceneTitle: board.scenes[0]!.title,
      salt: "salt-b",
    });
    expect(prompt).toContain("景别：");
    expect(prompt.length).toBeGreaterThan(20);
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
});
