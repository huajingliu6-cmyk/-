import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import type { AuthUser } from "@/auth/types";
import { createProjectRecord } from "@/projects/project-access";
import { saveScriptDraft } from "@/projects/script/script-draft-store";
import { updateGenerationApiConfig } from "@/auth/api-config";
import { runTextGenerationStream } from "@/text-generation/run-generation";
import {
  clearLastMockTextRequest,
  getLastMockTextRequest,
  getMockTextCallCount,
} from "@/text-generation/provider/mock-provider";

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
): Promise<void> {
  for await (const chunk of gen) {
    void chunk;
  }
}

describe("H2 runtime single-call composition", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousProvider = process.env.TEXT_LLM_PROVIDER;
  let tmp = "";

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-h2-runtime-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.TEXT_LLM_PROVIDER = "mock";
    clearLastMockTextRequest();
    await updateGenerationApiConfig("script-split-text", {
      provider: "mock",
      model: "mock-split",
    });
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousProvider === undefined) delete process.env.TEXT_LLM_PROVIDER;
    else process.env.TEXT_LLM_PROVIDER = previousProvider;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("script_split uses composed prompts in a single provider call", async () => {
    const owner = auth("h2-runtime-owner");
    const project = await createProjectRecord(owner.id, {
      name: "H2 Runtime",
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });

    const sourceText = [
      "第一场 雨夜茶馆",
      "林清推门而入。",
      "",
      "第二场 后巷",
      "阿棠递来旧伞。",
      "",
      "第三场 码头",
      "铜匣沉入江中。",
    ].join("\n");

    await saveScriptDraft({
      projectId: project.projectId,
      sourceText,
      episodes: [],
    });

    await drainSse(
      runTextGenerationStream({
        projectId: project.projectId,
        user: owner,
        outputKind: "script_split",
        brief: "按三幕节奏分为两集",
        modelKey: "balanced-default",
        targetChars: 400,
        idempotencyKey: "h2_script_split_once",
      }),
    );

    const last = getLastMockTextRequest();
    expect(last).not.toBeNull();
    expect(last!.systemPrompt).toContain("[PLATFORM_SYSTEM_POLICY]");
    expect(
      last!.systemPrompt.includes("[ADMIN_PUBLISHED_TASK_RULE]") ||
        last!.systemPrompt.includes("[BUILTIN_TASK_RULE]"),
    ).toBe(true);
    expect(last!.systemPrompt).toContain("[IMMUTABLE_OUTPUT_CONTRACT]");
    expect(last!.userPrompt).toContain("[UNTRUSTED_PROJECT_DATA]");
    expect(last!.userPrompt).toContain("【剧本块列表】");
    expect(getMockTextCallCount()).toBe(1);
  });
});
