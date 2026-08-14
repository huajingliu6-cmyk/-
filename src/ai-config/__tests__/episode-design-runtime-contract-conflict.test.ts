import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import type { AuthUser } from "@/auth/types";
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "@/auth/api-config";
import { createProjectRecord } from "@/projects/project-access";
import { saveScriptDraft } from "@/projects/script/script-draft-store";
import { getMockTextCallCount } from "@/text-generation/provider/mock-provider";
import { hashRuleContent } from "@/ai-config/task-rules-store";

vi.mock("@/ai-config/migrate-misbound-episode-design-rules", () => ({
  migrateMisboundEpisodeDesignTaskRules: vi.fn(async () => ({
    ran: false,
    episodeDesignReverted: false,
    designPromptAction: "none",
    contentHash: null,
    message: null,
    adminHint: null,
  })),
  listTaskRuleMigrationNotices: vi.fn(async () => []),
}));

const DESIGN_PROMPT_RULE = [
  "剧本出图设计｜精简任务规则",
  "只输出一段完整提示词。",
  "禁止输出资产清单。",
  "不要输出 JSON。",
].join("\n");

function auth(id: string): AuthUser {
  return {
    id,
    username: id,
    role: "user",
    displayName: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function drainSse(
  gen: AsyncGenerator<string, void, unknown>,
): Promise<{ codes: string[]; messages: string[] }> {
  const codes: string[] = [];
  const messages: string[] = [];
  for await (const chunk of gen) {
    const match = /event:\s*error\ndata:\s*(\{[\s\S]*?\})\n\n/.exec(chunk);
    if (match?.[1]) {
      try {
        const data = JSON.parse(match[1]) as {
          code?: string;
          message?: string;
        };
        if (data.code) codes.push(data.code);
        if (data.message) messages.push(data.message);
      } catch {
        /* ignore */
      }
    }
  }
  return { codes, messages };
}

describe("runtime episode-design contract conflict (migration disabled)", () => {
  const previous = process.env.APP_DATA_DIR;
  const previousProvider = process.env.TEXT_LLM_PROVIDER;
  let tmp = "";

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-rule-conflict-rt-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.TEXT_LLM_PROVIDER = "mock";
    await updateGenerationApiConfig("episode-asset-design-text", {
      provider: "mock",
      model: "mock-assets",
      enabled: true,
    });
    await updateCapabilityBinding(
      "asset.episode-design.generate",
      { profileSlotId: "episode-asset-design-text", enabled: true },
      "admin1",
    );
    writeFileSync(
      path.join(tmp, "ai-task-rules.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          rules: {
            "asset.episode-design.generate": {
              capabilityId: "asset.episode-design.generate",
              draft: null,
              publishedVersion: 1,
              versions: [
                {
                  version: 1,
                  content: DESIGN_PROMPT_RULE,
                  contentHash: hashRuleContent(DESIGN_PROMPT_RULE),
                  sourceType: "manual",
                  sourceFileName: null,
                  publishedBy: "legacy",
                  publishedAt: "2026-01-01T00:00:00.000Z",
                  rolledBackFromVersion: null,
                },
              ],
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    if (previousProvider === undefined) delete process.env.TEXT_LLM_PROVIDER;
    else process.env.TEXT_LLM_PROVIDER = previousProvider;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("does not call provider and returns AI_TASK_RULE_CONTRACT_CONFLICT", async () => {
    const { resolveAiExecutionPlan } = await import(
      "@/ai-config/execution-plan"
    );
    const { runTextGenerationStream } = await import(
      "@/text-generation/run-generation"
    );

    const before = getMockTextCallCount();
    await expect(
      resolveAiExecutionPlan({
        capabilityId: "asset.episode-design.generate",
        projectId: "p1",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ code: "AI_TASK_RULE_CONTRACT_CONFLICT" });
    expect(getMockTextCallCount()).toBe(before);

    const owner = auth("conflict-owner");
    const project = await createProjectRecord(owner.id, {
      name: "Conflict",
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    await saveScriptDraft({
      projectId: project.projectId,
      sourceText: "第1集\n甲出场。",
      episodes: [],
    });
    const stream = runTextGenerationStream({
      projectId: project.projectId,
      user: owner,
      outputKind: "script_asset_design",
      brief: "",
      modelKey: "balanced-default",
      targetChars: 2000,
      idempotencyKey: "idem-conflict-rt-1",
    });
    const { codes, messages } = await drainSse(stream);
    expect(codes).toContain("AI_TASK_RULE_CONTRACT_CONFLICT");
    expect(messages.some((m) => m.includes("固定输出格式冲突"))).toBe(true);
    expect(getMockTextCallCount()).toBe(before);
  });
});
