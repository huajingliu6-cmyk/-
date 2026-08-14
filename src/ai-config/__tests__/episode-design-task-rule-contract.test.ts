import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import {
  checkRule,
  getEffectivePublishedRule,
  hashRuleContent,
  publishRule,
  saveDraft,
} from "@/ai-config/task-rules-store";
import { getBuiltinTaskRule } from "@/ai-config/builtin-task-rules";
import {
  findEpisodeDesignTaskRuleContractConflicts,
  findTaskRuleOutputContractConflict,
} from "@/ai-config/task-rule-contract-guard";
import { migrateMisboundEpisodeDesignTaskRules } from "@/ai-config/migrate-misbound-episode-design-rules";

const DESIGN_PROMPT_RULE = [
  "剧本出图设计｜精简任务规则",
  "只输出一段完整提示词。",
  "禁止输出资产清单。",
  "不要输出 JSON。",
  "输出自然语言而不是 JSON。",
].join("\n");

const ASSET_JSON_RULE = [
  "你是专业影视资产策划师。",
  "通读剧本后输出资产设计 JSON。",
  '必须返回 {"version":1,"assets":[...]}，每项含 type、name、design。',
  "合并同名同类资产；不要输出解释性散文。",
].join("\n");

describe("episode-design task rule contract + migration", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-episode-rule-"));
    process.env.APP_DATA_DIR = tmp;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects prompt-only / ban-asset-list rules for asset.episode-design.generate", () => {
    const check = checkRule(
      DESIGN_PROMPT_RULE,
      "asset.episode-design.generate",
    );
    expect(check.errors.some((e) => e.code === "OUTPUT_CONTRACT_CONFLICT")).toBe(
      true,
    );
    expect(
      findEpisodeDesignTaskRuleContractConflicts(DESIGN_PROMPT_RULE),
    ).not.toBeNull();
  });

  it("allows normal asset JSON guidance for episode-design", () => {
    const check = checkRule(ASSET_JSON_RULE, "asset.episode-design.generate");
    expect(
      check.errors.filter((e) => e.code === "OUTPUT_CONTRACT_CONFLICT"),
    ).toEqual([]);
    expect(
      findTaskRuleOutputContractConflict(
        "asset.episode-design.generate",
        ASSET_JSON_RULE,
      ),
    ).toBeNull();
  });

  it("still allows prompt-only rules for asset.design-prompt.generate", async () => {
    const check = checkRule(
      DESIGN_PROMPT_RULE,
      "asset.design-prompt.generate",
    );
    expect(
      check.errors.filter((e) => e.code === "OUTPUT_CONTRACT_CONFLICT"),
    ).toEqual([]);
    await saveDraft(
      "asset.design-prompt.generate",
      DESIGN_PROMPT_RULE,
      "manual",
      null,
      null,
      "admin1",
    );
    await expect(
      publishRule("asset.design-prompt.generate", null, "ok-prompt", "admin1"),
    ).resolves.toMatchObject({ version: 1 });
  });

  it("blocks publishing conflicting episode-design rules", async () => {
    await saveDraft(
      "asset.episode-design.generate",
      DESIGN_PROMPT_RULE,
      "manual",
      null,
      null,
      "admin1",
    );
    await expect(
      publishRule("asset.episode-design.generate", null, "bad", "admin1"),
    ).rejects.toMatchObject({ code: "AI_TASK_RULE_CONFIG_INVALID" });
  });

  it("migrates misbound episode-design rule to design-prompt idempotently without overwriting", async () => {
    const storePath = path.join(tmp, "ai-task-rules.json");
    writeFileSync(
      storePath,
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

    const first = await migrateMisboundEpisodeDesignTaskRules();
    expect(first.ran).toBe(true);
    expect(first.episodeDesignReverted).toBe(true);
    expect(first.designPromptAction).toBe("copied");

    const episode = await getEffectivePublishedRule(
      "asset.episode-design.generate",
    );
    expect(episode.source).toBe("builtin");
    expect(episode.content).toBe(
      getBuiltinTaskRule("asset.episode-design.generate"),
    );

    const prompt = await getEffectivePublishedRule(
      "asset.design-prompt.generate",
    );
    expect(prompt.source).toBe("custom");
    expect(prompt.content).toBe(DESIGN_PROMPT_RULE);

    const second = await migrateMisboundEpisodeDesignTaskRules();
    expect(second.ran).toBe(false);
    // Already repaired → no custom conflicting rule left on episode-design.
    expect(second.episodeDesignReverted).toBe(false);
    expect(existsSync(path.join(tmp, "ai-task-rule-migrations.json"))).toBe(
      true,
    );

    await saveDraft(
      "asset.design-prompt.generate",
      "素材提示词：只输出一段完整提示词，写清服装材质。",
      "manual",
      null,
      null,
      "admin2",
    );
    await publishRule(
      "asset.design-prompt.generate",
      null,
      "user-prompt-v2",
      "admin2",
    );

    const afterPrompt = await getEffectivePublishedRule(
      "asset.design-prompt.generate",
    );
    writeFileSync(
      storePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          rules: {
            "asset.design-prompt.generate": {
              capabilityId: "asset.design-prompt.generate",
              draft: null,
              publishedVersion: afterPrompt.version,
              versions: [
                {
                  version: afterPrompt.version,
                  content: afterPrompt.content,
                  contentHash: afterPrompt.contentHash,
                  sourceType: "manual",
                  sourceFileName: null,
                  publishedBy: "admin2",
                  publishedAt: "2026-01-02T00:00:00.000Z",
                  rolledBackFromVersion: null,
                },
              ],
            },
            "asset.episode-design.generate": {
              capabilityId: "asset.episode-design.generate",
              draft: null,
              publishedVersion: 9,
              versions: [
                {
                  version: 9,
                  content: DESIGN_PROMPT_RULE + "\n（再次误绑）",
                  contentHash: hashRuleContent(
                    DESIGN_PROMPT_RULE + "\n（再次误绑）",
                  ),
                  sourceType: "manual",
                  sourceFileName: null,
                  publishedBy: "legacy2",
                  publishedAt: "2026-01-03T00:00:00.000Z",
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

    const third = await migrateMisboundEpisodeDesignTaskRules();
    expect(third.ran).toBe(true);
    expect(third.designPromptAction).toBe("skipped_existing_different");
    const promptAfter = await getEffectivePublishedRule(
      "asset.design-prompt.generate",
    );
    expect(promptAfter.content).toContain("写清服装材质");
    expect(promptAfter.content).not.toContain("再次误绑");
    const episodeAfter = await getEffectivePublishedRule(
      "asset.episode-design.generate",
    );
    expect(episodeAfter.source).toBe("builtin");
  });
});

describe("full-script extraction UI error contract", () => {
  it("shows extraction errors inside the pending empty panel", () => {
    const workspace = readFileSync(
      path.join(
        process.cwd(),
        "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
      ),
      "utf-8",
    );
    expect(workspace).toContain("extractionError");
    expect(workspace).toContain('data-testid="ead-extraction-error"');
    expect(workspace).toContain('role="alert"');
    expect(workspace).toContain("formatFullScriptExtractionError");
    expect(workspace).toContain("AI_TASK_RULE_CONTRACT_CONFLICT");
    expect(workspace).toContain("EMPTY_MODEL_OUTPUT");
    expect(workspace).toContain("EPISODE_ASSET_DESIGN_OUTPUT_INVALID");
    expect(workspace).toContain('data-testid="ead-extract-all-retry"');
    expect(workspace).toContain("setExtractionError(null)");
    expect(workspace).not.toMatch(
      /applyPayload\.record\.items\.length === 0[\s\S]{0,80}提取完成/,
    );
  });
});
