import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { generateStructuredStoryboard } from "@/projects/storyboard/services/storyboard-generate";
import {
  fillShotVideoPromptsWithLlm,
  MOCK_STORYBOARD_PROMPT_MARKER,
  parsePromptMap,
  parseRuleNativePromptBlocks,
  regenerateShotVideoPromptWithLlm,
} from "@/projects/storyboard/services/storyboard-prompt-llm";
import { AiConfigError } from "@/ai-config/errors";
import {
  STORYBOARD_PROMPT_RULE_VERSION,
  STORYBOARD_SHOT_DURATION_MIN,
  sumStoryboardDurationSeconds,
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

function shotsJson(entries: Array<{ shotId: string; videoPrompt: string }>): string {
  return JSON.stringify({ shots: entries });
}

const RICH_PROMPT = [
  "【总时长】14秒",
  "【画幅】16:9",
  "【时间轴·强制映射】",
  "0-5秒｜中景：林清推门",
  "5-10秒｜近景：环顾",
  "10-14秒｜特写：呼吸",
  "【位置结构】林清居中",
  "【连续性锁定】风衣与发型不变",
  "【声音设计】雨声、脚步",
  "【负面约束】禁止变脸",
].join("\n");

describe("storyboard-prompt-llm SHOT_ID_PROMPT_V1", () => {
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

  it("mock provider saves marked mock prompts, not unmarked templates", async () => {
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
    expect(filled.generatedCount).toBeGreaterThan(0);
    for (const shot of filled.storyboard.scenes.flatMap((s) => s.shots)) {
      expect(shot.videoPrompt).toContain(MOCK_STORYBOARD_PROMPT_MARKER);
      expect(shot.videoPrompt).toContain("非真实模型生成");
      expect(shot.durationSeconds).toBe(STORYBOARD_SHOT_DURATION_MIN);
    }
  });

  it("mock provider rejects in production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    mockResolved("mock");
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n人物走过。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    try {
      await expect(
        fillShotVideoPromptsWithLlm({
          projectId: "p1",
          userId: "u1",
          storyboard: board,
        }),
      ).rejects.toMatchObject({ code: "STORYBOARD_PROMPT_PROVIDER_MOCK" });
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("single-shot mock regen returns marked mock prompt", async () => {
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
    expect(prompt).toContain(MOCK_STORYBOARD_PROMPT_MARKER);
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

  it("parsePromptMap matches by shotId regardless of order", () => {
    const ids = ["shot_a", "shot_b"];
    const mapped = parsePromptMap(
      shotsJson([
        { shotId: "shot_b", videoPrompt: "乙" },
        { shotId: "shot_a", videoPrompt: "甲" },
      ]),
      new Set(ids),
      ids,
    );
    expect(mapped.get("shot_a")).toBe("甲");
    expect(mapped.get("shot_b")).toBe("乙");
  });

  it("parsePromptMap accepts rule-native blocks by order", () => {
    const ids = ["shot_a", "shot_b"];
    const raw = [
      "[分镜01｜总时长：12秒｜画幅：9:16]",
      "场景基调：雨夜茶馆。",
      "",
      "[分镜02｜总时长：10秒｜画幅：9:16]",
      "0.0—10.0秒｜近景：对白。",
    ].join("\n");
    expect(parseRuleNativePromptBlocks(raw)).toHaveLength(2);
    const mapped = parsePromptMap(raw, new Set(ids), ids);
    expect(mapped.get("shot_a")).toContain("[分镜01");
    expect(mapped.get("shot_b")).toContain("[分镜02");
  });

  it("throws when every pending shot is prompt-locked", async () => {
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
        shot.promptOrigin = "auto";
        shot.storyboardPromptRuleVersion = STORYBOARD_PROMPT_RULE_VERSION;
        shot.videoPrompt = "已有正文";
        shot.promptDraft = "已有正文";
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

  it("saves rich free-form prompts verbatim and keeps shot.durationSeconds", async () => {
    mockResolved("http");
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜街道\n林清缓步走来。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const targets = board.scenes.flatMap((scene) => scene.shots);
    const originalDuration = targets[0]!.durationSeconds;
    expect(originalDuration).toBe(STORYBOARD_SHOT_DURATION_MIN);
    const sumBefore = sumStoryboardDurationSeconds(targets);

    streamTextMock.mockImplementation(async function* (request: {
      userPrompt?: string;
    }) {
      const prompt = String(request?.userPrompt ?? "");
      expect(prompt).toContain("当前镜头原文");
      expect(prompt).toContain("只根据该 shot 自己的输入生成");
      const shotIds = [...prompt.matchAll(/shotId:\s*(\S+)/g)].map(
        (match) => match[1]!,
      );
      yield {
        type: "delta",
        text: shotsJson(
          shotIds.map((shotId) => ({ shotId, videoPrompt: RICH_PROMPT })),
        ),
      };
    });

    const filled = await fillShotVideoPromptsWithLlm({
      projectId: "p1",
      userId: "u1",
      storyboard: board,
      context: { scriptText: "林清雨夜寻弟。" },
    });

    expect(filled.generatedCount).toBe(targets.length);
    const first = filled.storyboard.scenes[0]!.shots[0]!;
    expect(first.promptLocked).toBe(true);
    expect(first.storyboardPromptRuleVersion).toBe(STORYBOARD_PROMPT_RULE_VERSION);
    expect(first.durationSeconds).toBe(originalDuration);
    expect(first.videoPrompt).toBe(RICH_PROMPT);
    expect(first.videoPrompt).toContain("【总时长】14秒");
    expect(sumStoryboardDurationSeconds(
      filled.storyboard.scenes.flatMap((s) => s.shots),
    )).toBe(sumBefore);
  });

  it("saves short natural-language prompts without requiring timeline", async () => {
    mockResolved("http");
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走过。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    streamTextMock.mockImplementation(async function* (request: {
      userPrompt?: string;
    }) {
      const shotIds = [
        ...String(request?.userPrompt ?? "").matchAll(/shotId:\s*(\S+)/g),
      ].map((m) => m[1]!);
      yield {
        type: "delta",
        text: shotsJson(
          shotIds.map((shotId) => ({
            shotId,
            videoPrompt: "雨夜，林清缓步走进画面。",
          })),
        ),
      };
    });

    const filled = await fillShotVideoPromptsWithLlm({
      projectId: "p1",
      userId: "u1",
      storyboard: board,
    });
    expect(
      filled.storyboard.scenes
        .flatMap((s) => s.shots)
        .every((s) => s.videoPrompt === "雨夜，林清缓步走进画面。"),
    ).toBe(true);
  });

  it("retries missing shotIds once and keeps successful shots", async () => {
    mockResolved("http");
    const board = generateStructuredStoryboard({
      scriptText: [
        "场景：雨夜街道",
        "林清缓步走来。",
        "她停在路口。",
        "抬头看向对面。",
        "",
        "EXT 废弃仓库",
        "她推门而入。",
        "环顾四周。",
        "听见脚步声。",
      ].join("\n"),
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const allShots = board.scenes.flatMap((scene) => scene.shots);
    expect(allShots.length).toBeGreaterThanOrEqual(4);

    let call = 0;
    streamTextMock.mockImplementation(async function* (request: {
      userPrompt?: string;
    }) {
      call += 1;
      const shotIds = [
        ...String(request?.userPrompt ?? "").matchAll(/shotId:\s*(\S+)/g),
      ].map((m) => m[1]!);
      const ids =
        call === 1 && shotIds.length > 1 ? shotIds.slice(0, -1) : shotIds;
      yield {
        type: "delta",
        text: shotsJson(
          ids.map((shotId) => ({
            shotId,
            videoPrompt: `提示词-${shotId}`,
          })),
        ),
      };
    });

    const filled = await fillShotVideoPromptsWithLlm({
      projectId: "p1",
      userId: "u1",
      storyboard: board,
      context: { scriptText: "林清雨夜寻弟，进入仓库。" },
    });

    expect(call).toBeGreaterThan(1);
    expect(filled.generatedCount).toBe(allShots.length);
    expect(
      filled.storyboard.scenes
        .flatMap((s) => s.shots)
        .every((s) => s.videoPrompt.startsWith("提示词-")),
    ).toBe(true);
  });

  it("rejects duplicate shotId as structural error", async () => {
    mockResolved("http");
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走过。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const shots = board.scenes.flatMap((s) => s.shots);
    const target = shots[0]!;
    for (const shot of shots.slice(1)) {
      shot.promptLocked = true;
      shot.promptOrigin = "auto";
      shot.storyboardPromptRuleVersion = STORYBOARD_PROMPT_RULE_VERSION;
      shot.videoPrompt = "已锁定";
      shot.promptDraft = "已锁定";
    }
    streamTextMock.mockImplementation(async function* () {
      yield {
        type: "delta",
        text: shotsJson([
          { shotId: target.id, videoPrompt: "一" },
          { shotId: target.id, videoPrompt: "二" },
        ]),
      };
    });

    await expect(
      fillShotVideoPromptsWithLlm({
        projectId: "p1",
        userId: "u1",
        storyboard: board,
      }),
    ).rejects.toMatchObject({
      code: "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED",
    });
  });

  it("ignores unknown shotId and does not overwrite other shots", async () => {
    mockResolved("http");
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走过。\n她停下。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    const realIds = board.scenes.flatMap((s) => s.shots.map((sh) => sh.id));
    streamTextMock.mockImplementation(async function* (request: {
      userPrompt?: string;
    }) {
      const shotIds = [
        ...String(request?.userPrompt ?? "").matchAll(/shotId:\s*(\S+)/g),
      ].map((m) => m[1]!);
      yield {
        type: "delta",
        text: shotsJson([
          ...shotIds.map((shotId) => ({
            shotId,
            videoPrompt: `ok-${shotId}`,
          })),
          { shotId: "unknown_shot_zzz", videoPrompt: "不应写入" },
        ]),
      };
    });

    const filled = await fillShotVideoPromptsWithLlm({
      projectId: "p1",
      userId: "u1",
      storyboard: board,
    });
    for (const id of realIds) {
      const shot = filled.storyboard.scenes
        .flatMap((s) => s.shots)
        .find((s) => s.id === id)!;
      expect(shot.videoPrompt).toBe(`ok-${id}`);
      expect(shot.videoPrompt).not.toContain("不应写入");
    }
  });
});
