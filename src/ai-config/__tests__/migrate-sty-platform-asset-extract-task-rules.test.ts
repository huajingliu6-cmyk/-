import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { migrateStyPlatformAssetExtractTaskRules } from "@/ai-config/migrate-sty-platform-asset-extract-task-rules";
import {
  getEffectivePublishedRule,
  listAllRuleSummaries,
} from "@/ai-config/task-rules-store";
import {
  STY_ASSET_DETAIL_EXTRACT_TASK_RULE,
  STY_ASSET_ROSTER_EXTRACT_TASK_RULE,
} from "@/ai-config/sty-platform-asset-extract-task-rules";
import { checkRule } from "@/ai-config/task-rules-store";

describe("migrateStyPlatformAssetExtractTaskRules", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-sty-rules-"));
    process.env.APP_DATA_DIR = tmp;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("STY rule packs pass output contract checks", () => {
    expect(
      checkRule(STY_ASSET_ROSTER_EXTRACT_TASK_RULE, "asset.roster.extract")
        .errors,
    ).toEqual([]);
    expect(
      checkRule(STY_ASSET_DETAIL_EXTRACT_TASK_RULE, "asset.detail.extract")
        .errors,
    ).toEqual([]);
  });

  it("STY roster rule covers character, scene, and prop", () => {
    expect(STY_ASSET_ROSTER_EXTRACT_TASK_RULE).toContain("character、scene、prop");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("环境设定图");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("道具静物");
  });

  it("publishes roster/detail rules idempotently", async () => {
    const first = await migrateStyPlatformAssetExtractTaskRules("admin1");
    expect(first.ran).toBe(true);
    expect(first.published).toEqual([
      "asset.roster.extract",
      "asset.detail.extract",
    ]);

    const roster = await getEffectivePublishedRule("asset.roster.extract");
    expect(roster.source).toBe("custom");
    expect(roster.content).toContain("STY 平台");

    const second = await migrateStyPlatformAssetExtractTaskRules("admin1");
    expect(second.ran).toBe(false);
    expect(second.skipped).toEqual([
      "asset.roster.extract",
      "asset.detail.extract",
    ]);

    const summaries = await listAllRuleSummaries();
    expect(
      summaries.find((s) => s.capabilityId === "asset.roster.extract")
        ?.publishedVersion,
    ).toBe(1);
  });
});
