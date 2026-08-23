import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { assetIdentity } from "@/projects/assets/extraction/identity";
import {
  ASSET_DETAIL_BATCH_SIZE,
  ASSET_DETAIL_CONCURRENCY,
} from "@/projects/assets/extraction/pipeline/constants";
import {
  parseDetailBatchOutput,
  runAssetDetailBatches,
} from "@/projects/assets/extraction/pipeline/details";
import {
  batchItems,
  computeExtractionProgress,
} from "@/projects/assets/extraction/pipeline/progress";
import { mergeRosterItems, parseRosterOutput } from "@/projects/assets/extraction/pipeline/roster";
import {
  isLiveExtractionStatus,
  type AssetRosterItem,
} from "@/projects/assets/extraction/types";
import type { TextGenerationProvider } from "@/text-generation/provider/types";
import type { ProviderTextStreamEvent } from "@/text-generation/types";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

function rosterItem(
  type: AssetRosterItem["type"],
  name: string,
  extras?: Partial<AssetRosterItem>,
): AssetRosterItem {
  return {
    assetKey: assetIdentity(type, name),
    type,
    name,
    aliases: extras?.aliases ?? [],
    episodeIds: extras?.episodeIds ?? ["ep1"],
    evidenceRefs: extras?.evidenceRefs ?? [],
  };
}

describe("asset extraction pipeline units", () => {
  it("merges aliases and dedupes roster names", () => {
    const merged = mergeRosterItems([
      rosterItem("character", "林清", { aliases: ["清清"], episodeIds: ["ep1"] }),
      rosterItem("character", "清清", { aliases: ["林清"], episodeIds: ["ep2"] }),
      rosterItem("scene", "雨夜茶馆"),
    ]);
    const characters = merged.filter((item) => item.type === "character");
    expect(characters).toHaveLength(1);
    expect(characters[0]?.name === "林清" || characters[0]?.name === "清清").toBe(
      true,
    );
    expect(characters[0]?.episodeIds.sort()).toEqual(["ep1", "ep2"]);
    expect(merged.some((item) => item.name === "雨夜茶馆")).toBe(true);
  });

  it("keeps roster items in script appearance order", () => {
    const parsed = parseRosterOutput(
      JSON.stringify({
        version: 1,
        assets: [
          { type: "character", name: "甲" },
          { type: "scene", name: "茶馆" },
          { type: "prop", name: "旧伞" },
          { type: "character", name: "乙" },
        ],
      }),
      ["ep1"],
      0,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const merged = mergeRosterItems(parsed.items);
    expect(merged.map((item) => `${item.type}:${item.name}`)).toEqual([
      "character:甲",
      "scene:茶馆",
      "prop:旧伞",
      "character:乙",
    ]);
  });

  it("parses a valid roster JSON and rejects invalid JSON", () => {
    const parsed = parseRosterOutput(
      JSON.stringify({
        version: 1,
        assets: [{ type: "prop", name: "旧伞", aliases: ["油纸伞"] }],
      }),
      ["ep1"],
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.items[0]?.name).toBe("旧伞");
    expect(parsed.items[0]?.aliases).toContain("油纸伞");
    expect(parseRosterOutput("not-json").ok).toBe(false);
  });

  it("accepts roster items with detail fields by stripping them", () => {
    const parsed = parseRosterOutput(
      JSON.stringify({
        version: 1,
        assets: [{ type: "character", name: "甲", prompt: "不应保留" }],
      }),
      ["ep1"],
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.items[0]?.name).toBe("甲");
  });

  it("splits detail work into batches of 5", () => {
    expect(ASSET_DETAIL_BATCH_SIZE).toBe(5);
    expect(ASSET_DETAIL_CONCURRENCY).toBe(3);
    const items = Array.from({ length: 12 }, (_, i) => i);
    const batches = batchItems(items, ASSET_DETAIL_BATCH_SIZE);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(5);
    expect(batches[1]).toHaveLength(5);
    expect(batches[2]).toHaveLength(2);
  });

  it("keeps successful assets when one item in the batch is missing", () => {
    const batch = [
      rosterItem("character", "甲"),
      rosterItem("character", "乙"),
      rosterItem("character", "丙"),
      rosterItem("character", "丁"),
      rosterItem("character", "戊"),
    ];
    const outcomes = parseDetailBatchOutput({
      batch,
      batchIndex: 1,
      text: JSON.stringify({
        version: 1,
        assets: batch.slice(0, 4).map((item) => ({
          assetKey: item.assetKey,
          type: item.type,
          name: item.name,
          design: { role: "配角", usageInEpisode: "出场" },
        })),
      }),
    });
    expect(outcomes.filter((item) => item.ok)).toHaveLength(4);
    const failed = outcomes.filter((item) => !item.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.name).toBe("戊");
    expect(failed[0]?.errorCode).toBe("ASSET_DETAIL_MISSING");
  });

  it("does not mark the whole batch failed when JSON is invalid", () => {
    const batch = [
      rosterItem("character", "甲"),
      rosterItem("character", "乙"),
    ];
    const outcomes = parseDetailBatchOutput({
      batch,
      batchIndex: 1,
      text: "<<<not json>>>",
    });
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((item) => !item.ok)).toBe(true);
    expect(outcomes.map((item) => item.name).sort()).toEqual(["乙", "甲"]);
  });

  it("retries only failed assets and does not recall completed ones", async () => {
    const items = [
      rosterItem("character", "甲"),
      rosterItem("character", "乙"),
      rosterItem("character", "丙"),
      rosterItem("character", "丁"),
      rosterItem("character", "戊"),
    ];
    let calls = 0;
    const provider: TextGenerationProvider = {
      estimateInputTokens: (text) => text.length,
      estimateMaxOutputTokens: (n) => n,
      async *streamText(input): AsyncGenerator<ProviderTextStreamEvent> {
        calls += 1;
        const keys = [
          ...input.userPrompt.matchAll(/"assetKey"\s*:\s*"([^"]+)"/g),
        ].map((match) => match[1]!);
        const unique = [...new Set(keys)];
        const returned =
          calls === 1 ? unique.slice(0, 4) : unique;
        yield {
          type: "delta",
          text: JSON.stringify({
            version: 1,
            assets: returned.map((assetKey) => ({
              assetKey,
              type: "character",
              name: assetKey.split(":")[1] ?? "角色",
              design: { role: "配角", usageInEpisode: "出场" },
            })),
          }),
        };
        yield { type: "done" };
      },
    };

    const first = await runAssetDetailBatches({
      items,
      provider,
      systemPrompt: "ASSET_DETAIL_PHASE",
      providerModelId: "mock",
      episodes: [],
    });
    expect(first.filter((item) => item.ok)).toHaveLength(4);
    const failed = first.filter((item) => !item.ok);
    expect(failed.map((item) => item.name)).toEqual(["戊"]);

    const retry = await runAssetDetailBatches({
      items: items.filter((item) => failed.some((entry) => entry.assetKey === item.assetKey)),
      provider,
      systemPrompt: "ASSET_DETAIL_PHASE",
      providerModelId: "mock",
      episodes: [],
    });
    expect(retry).toHaveLength(1);
    expect(retry[0]?.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("computes real progress bands", () => {
    expect(
      computeExtractionProgress({
        stage: "discovering_roster",
        rosterChunksCompleted: 0,
        rosterChunksTotal: 2,
        detailsCompleted: 0,
        detailsTotal: 10,
      }),
    ).toBe(0);
    expect(
      computeExtractionProgress({
        stage: "discovering_roster",
        rosterChunksCompleted: 2,
        rosterChunksTotal: 2,
        detailsCompleted: 0,
        detailsTotal: 10,
      }),
    ).toBe(15);
    expect(
      computeExtractionProgress({
        stage: "merging_roster",
        rosterChunksCompleted: 2,
        rosterChunksTotal: 2,
        detailsCompleted: 0,
        detailsTotal: 10,
      }),
    ).toBe(15);
    const mid = computeExtractionProgress({
      stage: "extracting_details",
      rosterChunksCompleted: 2,
      rosterChunksTotal: 2,
      detailsCompleted: 5,
      detailsTotal: 10,
    });
    expect(mid).toBe(15 + 38);
    const retry = computeExtractionProgress({
      stage: "retrying_failed_once",
      rosterChunksCompleted: 2,
      rosterChunksTotal: 2,
      detailsCompleted: 9,
      detailsTotal: 10,
    });
    expect(retry).toBeGreaterThanOrEqual(90);
    expect(retry).toBeLessThanOrEqual(99);
    expect(
      computeExtractionProgress({
        stage: "saving",
        rosterChunksCompleted: 2,
        rosterChunksTotal: 2,
        detailsCompleted: 10,
        detailsTotal: 10,
      }),
    ).toBe(98);
    expect(
      computeExtractionProgress({
        stage: "complete",
        rosterChunksCompleted: 2,
        rosterChunksTotal: 2,
        detailsCompleted: 10,
        detailsTotal: 10,
      }),
    ).toBe(100);
  });

  it("does not treat completed or failed details as a live overlay status", () => {
    expect(isLiveExtractionStatus("completed")).toBe(false);
    expect(isLiveExtractionStatus("failed")).toBe(false);
    expect(isLiveExtractionStatus("partial_completed")).toBe(false);
    expect(isLiveExtractionStatus("discovering_roster")).toBe(true);
    expect(isLiveExtractionStatus("merging_roster")).toBe(true);
    expect(isLiveExtractionStatus("extracting_details")).toBe(true);
    expect(isLiveExtractionStatus("retrying_failed_once")).toBe(true);
    expect(isLiveExtractionStatus("saving")).toBe(true);
  });
});

describe("pipeline replacement contracts", () => {
  it("run-task no longer uses script-chunk map-reduce as the product path", () => {
    const run = readSrc("src/projects/assets/extraction/run-task.ts");
    expect(run).not.toContain("runScriptAssetMapReduce");
    expect(run).not.toContain("retryFailedScriptAssetChunks");
    expect(run).toContain("ASSET_DETAIL_BATCH_SIZE");
    expect(run).toContain("ASSET_DETAIL_CONCURRENCY");
    expect(run).toContain("buildExtractionPhaseSystemPrompt");
    expect(run).toContain("progress:");
    expect(run).toContain("merging_roster");
    expect(run).toContain("saving");
  });

  it("does not expose failed assets or retry UI to users", () => {
    const amw = readSrc("src/projects/assets/AssetManagementWorkspace.tsx");
    const snapshot = readSrc("src/projects/assets/extraction/snapshot.ts");
    const types = readSrc("src/projects/assets/extraction/types.ts");
    expect(amw).not.toContain("仅重试失败资产");
    expect(amw).not.toContain("retryFailedOnly");
    expect(amw).not.toContain("asset-extraction-failed-list");
    expect(amw).toContain("ScriptAssetExtractPromptCard");
    expect(amw).toContain("restartAvailable");
    expect(snapshot).not.toContain("failedAssets");
    expect(snapshot).not.toContain("canRetryFailed");
    expect(types).toContain("discovering_roster");
    expect(types).toContain("merging_roster");
    expect(types).toContain("retrying_failed_once");
    expect(types).toContain("terminal_failed");
    expect(types).toContain("AssetExtractionProgress");
  });
});
