import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { generateStructuredStoryboard } from "@/projects/storyboard/services/storyboard-generate";
import { fillShotVideoPromptsWithLlm } from "@/projects/storyboard/services/storyboard-prompt-llm";
import * as taskRulesStore from "@/ai-config/task-rules-store";
import { getBuiltinTaskRule } from "@/ai-config/builtin-task-rules";
import { ruleStatusLabel, type CapabilityRuleSummary } from "@/auth/ai-admin/types";
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

const CAPABILITY_ID = "text.storyboard-prompt.generate" as const;
const CUSTOM_MARKER = "CUSTOM_RULE_TEST_123";

function customSummary(
  version: number,
): CapabilityRuleSummary {
  return {
    capabilityId: CAPABILITY_ID,
    label: "分镜提示词生成",
    modality: "text",
    status: "active",
    defaultProfileSlot: "storyboard-prompt-text",
    hasDraft: false,
    draftRevision: null,
    publishedVersion: version,
    publishedSource: "custom",
    versionCount: version,
    effectiveRulePreview: CUSTOM_MARKER,
    builtinRuleLength: 10,
  };
}
function mockResolvedHttp() {
  vi.mocked(resolveCapabilityForOutputKind).mockResolvedValue({
    capability: {
      id: CAPABILITY_ID,
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
      capabilityId: CAPABILITY_ID,
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

describe("storyboard custom task rule survives generation", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";
  const assetMatches: AssetMatchItem[] = [];
  let revertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-sb-custom-rule-"));
    process.env.APP_DATA_DIR = tmp;
    vi.mocked(resolveCapabilityForOutputKind).mockReset();
    streamTextMock.mockReset();
    mockResolvedHttp();
    revertSpy = vi.spyOn(taskRulesStore, "revertCapabilityToBuiltin");
  });

  afterEach(() => {
    revertSpy.mockRestore();
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps published custom rule after formal storyboard prompt generation", async () => {
    const customRule = [
      `标记：${CUSTOM_MARKER}`,
      "为每个 shotId 写一段带时间轴的完整 PromptClip。",
      "必须包含【总时长】与【时间轴·强制映射】。",
    ].join("\n");

    await taskRulesStore.saveDraft(
      CAPABILITY_ID,
      customRule,
      "manual",
      null,
      null,
      "admin",
    );
    const published = await taskRulesStore.publishRule(
      CAPABILITY_ID,
      null,
      `pub_${Date.now()}`,
      "admin",
    );
    expect(published.version).toBe(1);

    // 发布后重新保存草稿，验证生成流程不会清掉草稿或已发布版本
    await taskRulesStore.saveDraft(
      CAPABILITY_ID,
      `${customRule}\n（生成后仍应保留的草稿）`,
      "manual",
      null,
      null,
      "admin",
    );

    const before = await taskRulesStore.getEffectivePublishedRule(CAPABILITY_ID);
    expect(before.source).toBe("custom");
    expect(before.version).toBe(1);
    expect(before.content).toContain(CUSTOM_MARKER);
    expect(ruleStatusLabel(customSummary(1))).toBe("自定义 v1");

    const board = generateStructuredStoryboard({
      scriptText: "场景：客厅\n韩兆丰坐在沙发上。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });

    const capturedSystemPrompts: string[] = [];
    streamTextMock.mockImplementation(async function* (request: {
      systemPrompt?: string;
      userPrompt?: string;
    }) {
      const systemPrompt = String(request?.systemPrompt ?? "");
      capturedSystemPrompts.push(systemPrompt);
      const prompt = String(request?.userPrompt ?? "");
      const shotIds = [...prompt.matchAll(/shotId:\s*(\S+)/g)].map(
        (match) => match[1]!,
      );
      yield {
        type: "delta",
        text: JSON.stringify({
          shots: shotIds.map((shotId) => ({
            shotId,
            videoPrompt: `正文-${shotId}`,
          })),
        }),
      };
    });

    const filled = await fillShotVideoPromptsWithLlm({
      projectId: "p1",
      userId: "u1",
      storyboard: board,
    });
    expect(filled.generatedCount).toBeGreaterThan(0);

    // 正式生成过程不得调用 revertCapabilityToBuiltin
    expect(revertSpy).not.toHaveBeenCalled();

    const after = await taskRulesStore.getEffectivePublishedRule(CAPABILITY_ID);
    expect(after.source).toBe("custom");
    expect(after.version).toBe(1);
    expect(after.content).toContain(CUSTOM_MARKER);
    expect(ruleStatusLabel(customSummary(after.version!))).toBe("自定义 v1");

    const record = await taskRulesStore.getRuleRecord(CAPABILITY_ID);
    expect(record.publishedVersion).toBe(1);
    expect(record.draft).not.toBeNull();
    expect(record.draft?.content).toContain(CUSTOM_MARKER);
    expect(record.draft?.content).toContain("生成后仍应保留的草稿");
    const publishedEntry = record.versions.find((v) => v.version === 1);
    expect(publishedEntry?.content).toContain(CUSTOM_MARKER);

    expect(capturedSystemPrompts.length).toBeGreaterThan(0);
    const builtin = getBuiltinTaskRule(CAPABILITY_ID);
    for (const systemPrompt of capturedSystemPrompts) {
      expect(systemPrompt).toContain(CUSTOM_MARKER);
      expect(systemPrompt).toContain(customRule);
      expect(systemPrompt).toContain('"videoPrompt":"非空字符串"');
      expect(systemPrompt).not.toContain("【核心指令·音视频同步】");
      expect(systemPrompt).not.toContain("【首帧锚点】");
      // 不得被旧内置 PromptClip 强制格式覆盖
      expect(builtin).not.toContain("【时间轴·强制映射】");
      expect(systemPrompt).not.toContain("禁止短散文式空镜描述");
    }

    for (const scene of filled.storyboard.scenes) {
      for (const shot of scene.shots) {
        expect(shot.videoPrompt.trim().length).toBeGreaterThan(0);
      }
    }

    // 恢复内置只能由管理员点击触发
    await taskRulesStore.revertCapabilityToBuiltin(CAPABILITY_ID, "admin");
    expect(revertSpy).toHaveBeenCalledTimes(1);
    const restored = await taskRulesStore.getEffectivePublishedRule(CAPABILITY_ID);
    expect(restored.source).toBe("builtin");
    expect(restored.version).toBeNull();
  });
});
