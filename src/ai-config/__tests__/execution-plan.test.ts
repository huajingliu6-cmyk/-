import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { resolveAiExecutionPlan } from "@/ai-config/execution-plan";
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "@/auth/api-config";
import { saveDraft, publishRule } from "@/ai-config/task-rules-store";

describe("execution-plan", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-exec-plan-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.TEXT_LLM_PROVIDER = "mock";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  async function configureStoryMock() {
    await updateGenerationApiConfig("story-text", {
      provider: "mock",
      model: "mock-story",
      enabled: true,
    });
    await updateCapabilityBinding(
      "story.generate",
      { profileSlotId: "story-text", enabled: true },
      "admin1",
    );
  }

  it("resolves active capability with builtin rule and system sections", async () => {
    await configureStoryMock();
    const plan = await resolveAiExecutionPlan({
      capabilityId: "story.generate",
      dynamicInput: { brief: "测试材料" },
      projectId: "p_test",
    });
    expect(plan.capability.id).toBe("story.generate");
    expect(plan.taskRule.source).toBe("builtin");
    expect(plan.systemPrompt).toContain("[PLATFORM_SYSTEM_POLICY]");
    expect(plan.systemPrompt).toContain("[IMMUTABLE_OUTPUT_CONTRACT]");
    expect(plan.modelConnection.providerMode).toBe("mock");
    expect(plan.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses published custom task rule", async () => {
    await configureStoryMock();
    await saveDraft(
      "story.generate",
      "自定义故事规则：更紧凑叙事",
      "manual",
      null,
      null,
      "admin1",
    );
    await publishRule("story.generate", null, "pub1", "admin1");
    const plan = await resolveAiExecutionPlan({
      capabilityId: "story.generate",
      dynamicInput: "data",
    });
    expect(plan.taskRule.source).toBe("custom");
    expect(plan.taskRule.version).toBe(1);
    expect(plan.systemPrompt).toContain("自定义故事规则");
  });

  it("rejects planned capability", async () => {
    await saveDraft(
      "script.continue.generate",
      "Continue the script while preserving established story continuity.",
      "manual",
      null,
      null,
      "admin1",
    );
    await publishRule(
      "script.continue.generate",
      1,
      "planned-publish",
      "admin1",
    );
    await expect(
      resolveAiExecutionPlan({ capabilityId: "script.continue.generate" }),
    ).rejects.toMatchObject({ code: "AI_CAPABILITY_PLANNED" });
  });

  it("rejects unbound capability", async () => {
    await updateCapabilityBinding(
      "story.generate",
      { profileSlotId: null, enabled: true },
      "admin1",
    );
    await expect(
      resolveAiExecutionPlan({ capabilityId: "story.generate" }),
    ).rejects.toMatchObject({ code: "AI_MODEL_UNBOUND" });
  });
});
