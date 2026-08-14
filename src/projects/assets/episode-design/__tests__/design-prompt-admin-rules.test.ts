import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "@/auth/api-config";
import { saveDraft, publishRule } from "@/ai-config/task-rules-store";
import { createProjectRecord } from "@/projects/project-storage";
import { FICTIONAL_PHOTOREAL_LIKENESS_POLICY } from "@/ai-config/system-policy";

const streamTextMock = vi.fn();
let streamDeltaQueue: string[] = ["自定义提示词正文"];

vi.mock("@/text-generation/provider/http-compatible-provider", () => ({
  HttpCompatibleTextProvider: class {
    constructor() {}
    async *streamText(input: {
      systemPrompt: string;
      enableThinking?: boolean;
      messages?: Array<{ role: string; content: string }>;
    }) {
      streamTextMock(input);
      const next = streamDeltaQueue.shift() ?? "";
      yield { type: "delta" as const, text: next };
    }
  },
  normalizeHttpCompatibleModelId: (id: string) => id,
  buildHttpCompatibleChatBody: () => ({}),
}));

vi.mock("@/text-generation/provider/mock-provider", () => ({
  MockTextProvider: class {
    async *streamText(input: {
      systemPrompt: string;
      enableThinking?: boolean;
      messages?: Array<{ role: string; content: string }>;
    }) {
      streamTextMock(input);
      const next = streamDeltaQueue.shift() ?? "";
      yield { type: "delta" as const, text: next };
    }
  },
}));

describe("streamRedesignPromptInConversation admin task rules", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-design-prompt-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.TEXT_LLM_PROVIDER = "mock";
    streamTextMock.mockClear();
    streamDeltaQueue = ["自定义提示词正文"];

    await updateGenerationApiConfig("asset-design-prompt-text", {
      provider: "mock",
      model: "mock-design-prompt",
      enabled: true,
    });
    await updateCapabilityBinding(
      "asset.design-prompt.generate",
      { profileSlotId: "asset-design-prompt-text", enabled: true },
      "admin1",
    );
    await updateGenerationApiConfig("episode-asset-design-text", {
      provider: "mock",
      model: "mock-episode-extract",
      enabled: true,
    });
    await updateCapabilityBinding(
      "asset.episode-design.generate",
      { profileSlotId: "episode-asset-design-text", enabled: true },
      "admin1",
    );

    const project = await createProjectRecord("u_owner", {
      name: "提示词规则测试",
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
      visualStyle: "live_action_cinematic",
    });
    (globalThis as { __designPromptProjectId?: string }).__designPromptProjectId =
      project.projectId;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
    delete (globalThis as { __designPromptProjectId?: string }).__designPromptProjectId;
  });

  it("applies published asset.design-prompt.generate rule with independent messages", async () => {
    await saveDraft(
      "asset.design-prompt.generate",
      "剧本出图设计｜精简任务规则：必须写清服装材质与光影。",
      "manual",
      null,
      null,
      "admin1",
    );
    await publishRule("asset.design-prompt.generate", null, "prompt-pub-1", "admin1");

    const { streamRedesignPromptInConversation } = await import(
      "@/projects/assets/episode-design/generate-design-prompt"
    );
    const projectId = (globalThis as { __designPromptProjectId?: string })
      .__designPromptProjectId!;

    const result = await streamRedesignPromptInConversation({
      projectId,
      userId: "u_owner",
      item: {
        id: "item_1",
        assetType: "character",
        name: "林晚",
        draft: {
          description: "女主",
          appearance: "短发",
          clothing: "青衫",
          role: "主角",
          age: "28",
          voiceId: null,
          voiceName: null,
          voiceBound: false,
          usageInEpisode: "开场",
          evidence: "第一场",
        },
      } as never,
      conversation: [
        {
          role: "system",
          content: "STALE_SYSTEM_SHOULD_NOT_WIN —— 旧提取规则",
          at: "2026-01-01T00:00:00.000Z",
        },
        {
          role: "user",
          content: "请提取本集资产",
          at: "2026-01-01T00:00:01.000Z",
        },
        {
          role: "assistant",
          content: '{"assets":[]}',
          at: "2026-01-01T00:00:02.000Z",
        },
      ],
      episodeText: "林晚推开茶馆木门，青衫被风掀起。",
      userRequirement: "青衫布料要有褶皱",
      promptModelId: "deepseek-v4-pro",
    });

    expect(result.capabilityId).toBe("asset.design-prompt.generate");
    expect(result.taskRuleSource).toBe("custom");
    expect(result.taskRuleVersion).toBe(1);
    expect(result.taskRuleHash).toMatch(/^[a-f0-9]+$/i);
    expect(result.modelConnectionId).toBeTruthy();
    expect(result.systemPolicyVersion).toBeTruthy();
    expect(result.outputContractVersion).toBeTruthy();
    expect(result.systemPrompt).toContain("[ADMIN_PUBLISHED_TASK_RULE]");
    expect(result.systemPrompt).toContain("剧本出图设计｜精简任务规则");
    expect(result.systemPrompt).toContain("[IMMUTABLE_OUTPUT_CONTRACT]");
    expect(result.systemPrompt).toContain(FICTIONAL_PHOTOREAL_LIKENESS_POLICY);
    expect(result.systemPrompt).not.toContain("避免写实真人照片");
    expect(result.systemPrompt).not.toContain("STALE_SYSTEM_SHOULD_NOT_WIN");
    expect(result.enableThinking).toBe(false);
    expect(result.messageRoles).toBe("system,user");
    expect(result.systemPromptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.userPromptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.diagnostics.outputKind).toBe("asset_design_prompt");

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const call = streamTextMock.mock.calls[0]![0] as {
      systemPrompt: string;
      enableThinking?: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.enableThinking).toBe(false);
    expect(call.systemPrompt).toContain("剧本出图设计｜精简任务规则");
    expect(call.messages).toHaveLength(2);
    expect(call.messages[0]?.role).toBe("system");
    expect(call.messages[0]?.content).toContain("[ADMIN_PUBLISHED_TASK_RULE]");
    expect(call.messages[0]?.content).toContain(FICTIONAL_PHOTOREAL_LIKENESS_POLICY);
    expect(
      call.messages.some((m) => m.content.includes("STALE_SYSTEM_SHOULD_NOT_WIN")),
    ).toBe(false);
    expect(call.messages.filter((m) => m.role === "system")).toHaveLength(1);
    expect(call.messages[1]?.role).toBe("user");
    expect(call.messages[1]?.content).toContain("[UNTRUSTED_PROJECT_DATA]");
    expect(call.messages[1]?.content).toContain("林晚");
    expect(call.messages[1]?.content).toContain("【外貌】短发");
    expect(call.messages[1]?.content).toContain("林晚推开茶馆木门");
    expect(call.messages[1]?.content).toContain("青衫布料要有褶皱");
    expect(call.messages[1]?.content).not.toContain("episode_asset_design");

    // Redacted diagnostics artifact for delivery report (no API keys / full scripts).
    const outDir = path.join(
      "E:",
      "DevWorkspace",
      "runtime",
      "InfiniteCanvas",
      "tmp-design-prompt-diag",
    );
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      path.join(outDir, "diagnostics.json"),
      JSON.stringify(
        {
          uiFormalPromptSource: "result.text → designPrompt.text",
          formalPromptPreview: result.text.slice(0, 120),
          capabilityId: result.capabilityId,
          outputKind: result.diagnostics.outputKind,
          taskRuleSource: result.taskRuleSource,
          taskRuleVersion: result.taskRuleVersion,
          taskRuleHash: result.taskRuleHash,
          modelConnectionId: result.modelConnectionId,
          providerModelId: result.providerModelId,
          modelKey: result.promptModelId,
          systemPolicyVersion: result.systemPolicyVersion,
          outputContractVersion: result.outputContractVersion,
          inputFingerprint: result.inputFingerprint,
          systemPromptHash: result.systemPromptHash,
          userPromptHash: result.userPromptHash,
          messageRoles: result.messageRoles,
          enableThinking: result.enableThinking,
          maxOutputTokens: result.maxOutputTokens,
          systemHasAdminPublishedRule: true,
          staleExtractSystemAbsent: true,
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  it("uses asset_design_prompt capability line, not episode extract", async () => {
    const { streamRedesignPromptInConversation } = await import(
      "@/projects/assets/episode-design/generate-design-prompt"
    );
    const src = readFileSync(
      path.join(
        process.cwd(),
        "src/projects/assets/episode-design/generate-design-prompt.ts",
      ),
      "utf-8",
    );
    expect(src).toContain('resolveCapabilityForOutputKind("asset_design_prompt")');
    expect(src).toContain('"asset.design-prompt.generate"');
    expect(src).toContain("assembleUntrustedUserData");
    expect(src).toMatch(/enableThinking\s*=\s*false/);
    expect(src).not.toContain("concept art of");
    expect(src).not.toContain(
      'resolveCapabilityForOutputKind("episode_asset_design")',
    );

    const projectId = (globalThis as { __designPromptProjectId?: string })
      .__designPromptProjectId!;
    await expect(
      streamRedesignPromptInConversation({
        projectId,
        userId: "u_owner",
        item: {
          id: "item_1",
          assetType: "prop",
          name: "旧钥匙",
          draft: { propType: "小道具", usage: "开锁", usageInEpisode: "中段" },
        } as never,
        conversation: [
          { role: "user", content: "seed", at: "2026-01-01T00:00:00.000Z" },
          { role: "assistant", content: "ok", at: "2026-01-01T00:00:01.000Z" },
        ],
        episodeText: "钥匙掉落在地。",
      }),
    ).resolves.toMatchObject({
      capabilityId: "asset.design-prompt.generate",
    });
  });

  it("rejects empty model output without draft/english fallback", async () => {
    streamDeltaQueue = ["   "];
    const { streamRedesignPromptInConversation } = await import(
      "@/projects/assets/episode-design/generate-design-prompt"
    );
    const projectId = (globalThis as { __designPromptProjectId?: string })
      .__designPromptProjectId!;

    await expect(
      streamRedesignPromptInConversation({
        projectId,
        userId: "u_owner",
        item: {
          id: "item_1",
          assetType: "character",
          name: "空输出",
          draft: {
            description: "x",
            appearance: "y",
            clothing: "z",
            role: "配角",
            age: "20",
            voiceId: null,
            voiceName: null,
            voiceBound: false,
            usageInEpisode: "",
            evidence: "",
          },
        } as never,
        conversation: [
          { role: "user", content: "seed", at: "2026-01-01T00:00:00.000Z" },
          { role: "assistant", content: "ok", at: "2026-01-01T00:00:01.000Z" },
        ],
        episodeText: "正文",
      }),
    ).rejects.toThrow(/模型未返回有效的资产设计提示词/);
  });

  it("rejects extract-field dump, retries once, then saves corrected prompt", async () => {
    streamDeltaQueue = [
      "【角色描述】女主\n【外貌】短发\n【服装】青衫",
      "超写实真人影视摄影，虚构角色林晚，青衫褶皱，侧光剧照",
    ];
    const { streamRedesignPromptInConversation } = await import(
      "@/projects/assets/episode-design/generate-design-prompt"
    );
    const projectId = (globalThis as { __designPromptProjectId?: string })
      .__designPromptProjectId!;

    const result = await streamRedesignPromptInConversation({
      projectId,
      userId: "u_owner",
      item: {
        id: "item_1",
        assetType: "character",
        name: "林晚",
        draft: {
          description: "女主",
          appearance: "短发",
          clothing: "青衫",
          role: "主角",
          age: "28",
          voiceId: null,
          voiceName: null,
          voiceBound: false,
          usageInEpisode: "开场",
          evidence: "第一场",
        },
      } as never,
      conversation: [
        { role: "user", content: "seed", at: "2026-01-01T00:00:00.000Z" },
        { role: "assistant", content: "ok", at: "2026-01-01T00:00:01.000Z" },
      ],
      episodeText: "林晚推门。",
    });

    expect(result.text).toContain("超写实真人影视摄影");
    expect(result.text).not.toContain("【角色描述】");
    expect(result.diagnostics.formatCorrectionRetried).toBe(true);
    expect(streamTextMock).toHaveBeenCalledTimes(2);
    const second = streamTextMock.mock.calls[1]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(
      second.messages.some((m) =>
        m.content.includes("上一次输出是资产信息摘录"),
      ),
    ).toBe(true);
  });

  it("returns AI_DESIGN_PROMPT_FORMAT_INVALID after two extract dumps", async () => {
    streamDeltaQueue = [
      "【角色描述】女主\n【外貌】短发\n【服装】青衫",
      "【角色定位】主角\n【年龄】28\n【本集用途】开场",
    ];
    const { streamRedesignPromptInConversation } = await import(
      "@/projects/assets/episode-design/generate-design-prompt"
    );
    const projectId = (globalThis as { __designPromptProjectId?: string })
      .__designPromptProjectId!;

    await expect(
      streamRedesignPromptInConversation({
        projectId,
        userId: "u_owner",
        item: {
          id: "item_1",
          assetType: "character",
          name: "林晚",
          draft: {
            description: "女主",
            appearance: "短发",
            clothing: "青衫",
            role: "主角",
            age: "28",
            voiceId: null,
            voiceName: null,
            voiceBound: false,
            usageInEpisode: "开场",
            evidence: "第一场",
          },
        } as never,
        conversation: [
          { role: "user", content: "seed", at: "2026-01-01T00:00:00.000Z" },
          { role: "assistant", content: "ok", at: "2026-01-01T00:00:01.000Z" },
        ],
        episodeText: "林晚推门。",
      }),
    ).rejects.toMatchObject({ code: "AI_DESIGN_PROMPT_FORMAT_INVALID" });
  });

  it("does not call the provider when execution plan fails", async () => {
    await updateCapabilityBinding(
      "asset.design-prompt.generate",
      { profileSlotId: null, enabled: true },
      "admin1",
    );
    const { streamRedesignPromptInConversation } = await import(
      "@/projects/assets/episode-design/generate-design-prompt"
    );
    const projectId = (globalThis as { __designPromptProjectId?: string })
      .__designPromptProjectId!;

    await expect(
      streamRedesignPromptInConversation({
        projectId,
        userId: "u_owner",
        item: {
          id: "item_1",
          assetType: "scene",
          name: "雨巷",
          draft: {
            timeOfDay: "夜",
            location: "雨巷",
            style: "冷调",
            usageInEpisode: "转场",
          },
        } as never,
        conversation: [
          { role: "user", content: "seed", at: "2026-01-01T00:00:00.000Z" },
          { role: "assistant", content: "ok", at: "2026-01-01T00:00:01.000Z" },
        ],
        episodeText: "雨巷潮湿。",
      }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/AI_MODEL_UNBOUND|AI_CAPABILITY_NOT_CONFIGURED/),
    });

    expect(streamTextMock).not.toHaveBeenCalled();
  });
});

describe("generate-prompt route capability metadata contracts", () => {
  const management = readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-prompt/route.ts",
    ),
    "utf-8",
  );
  const workspace = readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/workspace/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-prompt/route.ts",
    ),
    "utf-8",
  );
  const runGeneration = readFileSync(
    path.join(process.cwd(), "src/text-generation/run-generation.ts"),
    "utf-8",
  );
  const conversation = readFileSync(
    path.join(
      process.cwd(),
      "src/projects/assets/episode-design/design-conversation.ts",
    ),
    "utf-8",
  );

  it("personal and workspace routes share metadata and pass episodeText", () => {
    for (const route of [management, workspace]) {
      expect(route).toContain('capabilityId: "asset.design-prompt.generate"');
      expect(route).toContain('outputKind: "asset_design_prompt"');
      expect(route).not.toContain(
        'capabilityId: "asset.episode-design.generate"',
      );
      expect(route).not.toContain("episode-asset-design-text");
      expect(route).toContain("taskRuleSource: result.taskRuleSource");
      expect(route).toContain("taskRuleVersion: result.taskRuleVersion");
      expect(route).toContain("taskRuleHash: result.taskRuleHash");
      expect(route).toContain("modelConnectionId: result.modelConnectionId");
      expect(route).toContain("systemPromptHash: result.systemPromptHash");
      expect(route).toContain("userPromptHash: result.userPromptHash");
      expect(route).toContain("enableThinking: result.enableThinking");
      expect(route).toContain("episodeText: detail.episode.content");
      expect(route).toContain("streamRedesignPromptInConversation");
    }
  });

  it("run-generation fails closed when execution plan is unavailable", () => {
    expect(runGeneration).not.toContain(
      "Keep legacy prompt assembly when execution plan is unavailable",
    );
    expect(runGeneration).toContain('event: "error"');
    expect(runGeneration).toContain("[ADMIN_PUBLISHED_TASK_RULE]");
    expect(runGeneration).toContain("outputKindToCapabilityId");
  });

  it("extract conversation seeds from episode-design execution plan", () => {
    expect(conversation).toContain('capabilityId: "asset.episode-design.generate"');
    expect(conversation).toContain("resolveAiExecutionPlan");
    expect(conversation).not.toContain('buildSystemPrompt("episode_asset_design"');
  });
});

describe("platform likeness policy copy", () => {
  it("allows photoreal fiction and bans real-person likeness", () => {
    expect(FICTIONAL_PHOTOREAL_LIKENESS_POLICY).toContain("允许超写实真人");
    expect(FICTIONAL_PHOTOREAL_LIKENESS_POLICY).toContain("不得复刻");
    expect(FICTIONAL_PHOTOREAL_LIKENESS_POLICY).not.toContain("避免写实真人照片");
    const modal = readFileSync(
      path.join(process.cwd(), "src/projects/assets/DesignAssetModal.tsx"),
      "utf-8",
    );
    expect(modal).not.toContain("避免写实真人剧照");
    expect(modal).not.toContain("避免写实真人照片");
  });
});
