import { describe, expect, it, vi } from "vitest";
import { ASSET_EXTRACTION_POLICY, assertDetailBatchPolicy } from "@/projects/assets/extraction/asset-extraction-policy";
import { parseRosterOutput } from "@/projects/assets/extraction/pipeline/roster";
import {
  parseDetailBatchOutput,
  runAssetDetailBatches,
} from "@/projects/assets/extraction/pipeline/details";
import { assetIdentity } from "@/projects/assets/extraction/identity";
import type { AssetRosterItem } from "@/projects/assets/extraction/types";
import {
  assetExtractionPhaseToCapabilityId,
  isLegacyAssetExtractOutputKind,
} from "@/projects/assets/extraction/extraction-capabilities";
import { buildImmutableOutputContract } from "@/ai-config/output-contracts";
import { getBuiltinTaskRule } from "@/ai-config/builtin-task-rules";
import { findTaskRuleOutputContractConflict } from "@/ai-config/task-rule-contract-guard";
import {
  CHARACTER_SETTING_CARD_NEGATIVE_CONSTRAINTS,
  STY_ASSET_DETAIL_EXTRACT_TASK_RULE,
  STY_ASSET_ROSTER_EXTRACT_TASK_RULE,
} from "@/ai-config/sty-platform-asset-extract-task-rules";
import type { TextGenerationProvider } from "@/text-generation/provider/types";
import type { ProviderTextStreamEvent } from "@/text-generation/types";

function rosterItem(name: string): AssetRosterItem {
  const type = "character" as const;
  return {
    assetKey: assetIdentity(type, name),
    type,
    name,
    aliases: [],
    episodeIds: ["ep1"],
    evidenceRefs: [],
  };
}

describe("asset extraction AI capabilities", () => {
  it("maps roster/detail phases to independent capabilities", () => {
    expect(assetExtractionPhaseToCapabilityId("roster")).toBe(
      "asset.roster.extract",
    );
    expect(assetExtractionPhaseToCapabilityId("detail")).toBe(
      "asset.detail.extract",
    );
  });

  it("marks legacy output kinds as deprecated entry points", () => {
    expect(isLegacyAssetExtractOutputKind("script_asset_design")).toBe(true);
    expect(isLegacyAssetExtractOutputKind("episode_asset_design")).toBe(true);
    expect(isLegacyAssetExtractOutputKind("story")).toBe(false);
  });

  it("defines roster and detail immutable contracts separately from legacy", () => {
    const roster = buildImmutableOutputContract("asset.roster.extract");
    const detail = buildImmutableOutputContract("asset.detail.extract");
    const legacy = buildImmutableOutputContract("asset.episode-design.generate");
    expect(roster).toContain("assetKey");
    expect(roster).toContain("evidenceRefs");
    expect(roster).toContain("Do NOT return design");
    expect(detail).toContain('"design"');
    expect(detail).toContain("assetKey");
    expect(detail).toContain("SINGLE-PERSON ONLY");
    expect(detail).toContain("无双人");
    expect(detail).toContain("无并排两人");
    expect(detail).toContain("For type=scene");
    expect(detail).toContain("For type=prop");
    expect(detail).toContain("无人物、无路人");
    expect(legacy).toContain("DEPRECATED");
  });

  it("STY roster rule discovers character, scene, and prop assets", () => {
    expect(STY_ASSET_ROSTER_EXTRACT_TASK_RULE).toContain("character、scene、prop");
    expect(STY_ASSET_ROSTER_EXTRACT_TASK_RULE).not.toContain("不负责场景、道具");
    expect(STY_ASSET_ROSTER_EXTRACT_TASK_RULE).toContain("type=scene");
    expect(STY_ASSET_ROSTER_EXTRACT_TASK_RULE).toContain("type=prop");
    expect(STY_ASSET_ROSTER_EXTRACT_TASK_RULE).toContain("detailBatchSize: 5");
    expect(STY_ASSET_ROSTER_EXTRACT_TASK_RULE).toContain("terminal_failed");
  });

  it("STY detail rule preserves full skill single-character constraints", () => {
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("单角色画面硬约束");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("无镜中人");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("固定画面规范");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain(CHARACTER_SETTING_CARD_NEGATIVE_CONSTRAINTS);
  });

  it("STY detail rule uses type-specific templates", () => {
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("单角色画面硬约束");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("无双人");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("左侧 1/3");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("Front 正面");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("环境设定图");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("道具静物");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("禁止把角色设定卡模板用于场景或道具");
  });

  it("parses scene and prop detail batches", () => {
    const batch = [
      {
        assetKey: assetIdentity("scene", "雨夜茶馆"),
        type: "scene" as const,
        name: "雨夜茶馆",
        aliases: [],
        episodeIds: ["ep1"],
        evidenceRefs: [],
      },
      {
        assetKey: assetIdentity("prop", "旧伞"),
        type: "prop" as const,
        name: "旧伞",
        aliases: [],
        episodeIds: ["ep1"],
        evidenceRefs: [],
      },
    ];
    const outcomes = parseDetailBatchOutput({
      batch,
      batchIndex: 1,
      text: JSON.stringify({
        version: 1,
        assets: [
          {
            assetKey: batch[0]!.assetKey,
            type: "scene",
            name: "雨夜茶馆",
            design: {
              location: "老旧茶馆",
              timeOfDay: "夜",
              style: "写实冷调",
              usageInEpisode: "第1场",
              description: "16:9环境建立镜头…无人物、无路人",
            },
          },
          {
            assetKey: batch[1]!.assetKey,
            type: "prop",
            name: "旧伞",
            design: {
              propType: "随身道具",
              usage: "信物",
              usageInEpisode: "第2场",
              description: "16:9道具静物…无人物、无人手",
            },
          },
        ],
      }),
    });
    expect(outcomes.filter((item) => item.ok)).toHaveLength(2);
    expect(outcomes.find((item) => item.name === "雨夜茶馆")?.asset?.assetType).toBe(
      "scene",
    );
    expect(outcomes.find((item) => item.name === "旧伞")?.asset?.assetType).toBe(
      "prop",
    );
  });

  it("STY detail rule enforces single-character setting card template for characters only", () => {
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("单角色画面硬约束");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("无双人");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("左侧 1/3");
    expect(STY_ASSET_DETAIL_EXTRACT_TASK_RULE).toContain("Front 正面");
  });

  it("strips detail fields from roster JSON instead of failing the whole chunk", () => {
    const parsed = parseRosterOutput(
      JSON.stringify({
        version: 1,
        assets: [
          {
            type: "character",
            name: "张三",
            design: { appearance: "不应进入名单" },
            description: "也不应进入名单",
          },
        ],
      }),
      ["ep1"],
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.items[0]?.name).toBe("张三");
  });

  it("prefers chunk episode ids over model placeholders", () => {
    const parsed = parseRosterOutput(
      JSON.stringify({
        version: 1,
        assets: [{ type: "character", name: "韩兆丰", episodeIds: ["episode_1"] }],
      }),
      ["ep_real_1"],
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.items[0]?.episodeIds).toEqual(["ep_real_1"]);
  });

  it("ignores out-of-batch assetKey in detail parse without marking batch items ok", () => {
    const batch = [rosterItem("甲"), rosterItem("乙")];
    const outcomes = parseDetailBatchOutput({
      batch,
      batchIndex: 1,
      text: JSON.stringify({
        version: 1,
        assets: [
          {
            assetKey: "character:extraneous",
            type: "character",
            name: "外来",
            design: { role: "配角" },
          },
          {
            assetKey: batch[0]!.assetKey,
            type: "character",
            name: "甲",
            design: { role: "主角" },
          },
        ],
      }),
    });
    expect(outcomes.filter((item) => item.ok)).toHaveLength(1);
    expect(outcomes.find((item) => item.name === "甲")?.ok).toBe(true);
    expect(outcomes.find((item) => item.name === "乙")?.ok).toBe(false);
  });

  it("enforces detail batch size and concurrency policy", () => {
    expect(() =>
      assertDetailBatchPolicy({
        batchSize: ASSET_EXTRACTION_POLICY.detailBatchSize + 1,
        concurrency: 1,
      }),
    ).toThrow("ASSET_EXTRACTION_POLICY_BATCH_SIZE_EXCEEDED");
    expect(() =>
      assertDetailBatchPolicy({
        batchSize: 5,
        concurrency: ASSET_EXTRACTION_POLICY.detailConcurrency + 1,
      }),
    ).toThrow("ASSET_EXTRACTION_POLICY_CONCURRENCY_EXCEEDED");
  });

  it("retries only one round at policy level", () => {
    expect(ASSET_EXTRACTION_POLICY.detailRetryRounds).toBe(1);
  });

  it("rejects ban-json rules for roster capability", () => {
    const conflict = findTaskRuleOutputContractConflict(
      "asset.roster.extract",
      "不要输出 JSON，只输出自然语言",
    );
    expect(conflict?.code).toBe("OUTPUT_CONTRACT_CONFLICT");
  });

  it("ships non-empty builtin rules for new capabilities", () => {
    expect(getBuiltinTaskRule("asset.roster.extract").length).toBeGreaterThan(
      20,
    );
    expect(getBuiltinTaskRule("asset.detail.extract").length).toBeGreaterThan(
      20,
    );
  });

  it("does not duplicate-call completed assets on retry pass", async () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      rosterItem(`角色${i + 1}`),
    );
    let calls = 0;
    const provider: TextGenerationProvider = {
      estimateInputTokens: (text) => text.length,
      estimateMaxOutputTokens: (n) => n,
      async *streamText(): AsyncGenerator<ProviderTextStreamEvent> {
        calls += 1;
        yield { type: "delta", text: '{"version":1,"assets":[]}' };
        yield { type: "done" };
      },
    };
    await runAssetDetailBatches({
      items,
      provider,
      systemPrompt: "detail",
      providerModelId: "mock",
      episodes: [],
      batchSize: 5,
      concurrency: 3,
    });
    expect(calls).toBe(2);
  });
});
