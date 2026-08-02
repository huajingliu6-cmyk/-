import { describe, expect, it } from "vitest";
import {
  extractRequirements,
  matchAssetByName,
  runAutoMatch,
} from "@/projects/storyboard/services/asset-match";
import type { AssetMatchItem } from "@/projects/storyboard/types";

describe("asset-match", () => {
  const assets = {
    characters: [{ id: "c1", name: "林清", projectId: "p1", role: "", description: "", appearance: "", clothing: "", age: "", gender: "", voiceId: null, voiceName: null, voiceStyle: null, imageFileName: null, imageObjectUrl: null, imageMimeType: null, status: "draft" as const }],
    scenes: [{ id: "s1", name: "雨夜街道", projectId: "p1", sceneType: "", description: "", timeOfDay: "", location: "", style: "", imageFileName: null, imageObjectUrl: null, imageMimeType: null, status: "draft" as const }],
    props: [{ id: "p1", name: "旧雨伞", projectId: "p1", propType: "", usage: "", description: "", imageFileName: null, imageObjectUrl: null, imageMimeType: null, status: "draft" as const }],
    audios: [{ id: "a1", name: "雨声", projectId: "p1", type: "sfx" as const, duration: "", source: "", fileName: null, objectUrl: null, mimeType: null, status: "draft" as const }],
  };

  it("extracts conservative requirements from Chinese script", () => {
    const script = [
      "场景：雨夜街道",
      "林清出场。",
      "林清说：「我们走吧」",
      "道具：旧雨伞",
      "音效：雨声",
    ].join("\n");

    const reqs = extractRequirements(script);
    expect(reqs.some((r) => r.assetType === "character" && r.extractedName.includes("林清"))).toBe(true);
    expect(reqs.some((r) => r.assetType === "scene" && r.extractedName.includes("雨夜"))).toBe(true);
    expect(reqs.some((r) => r.assetType === "prop" && r.extractedName.includes("旧雨伞"))).toBe(true);
    expect(reqs.some((r) => r.assetType === "audio" && r.extractedName.includes("雨声"))).toBe(true);
  });

  it("returns empty extraction for blank script", () => {
    expect(extractRequirements("   ")).toEqual([]);
  });

  it("matches exact normalized names as high confidence", () => {
    const match = matchAssetByName("林清", assets.characters);
    expect(match.confidence).toBe("high");
    expect(match.matchedAssetId).toBe("c1");
  });

  it("matches substring names as possible confidence", () => {
    const match = matchAssetByName("雨夜", assets.scenes);
    expect(match.confidence).toBe("possible");
    expect(match.matchedAssetId).toBe("s1");
  });

  it("runAutoMatch preserves locked and manual matches", () => {
    const script = "林清说：「你好」\n道具：旧雨伞";
    const manual: AssetMatchItem = {
      id: "match_manual",
      assetType: "character",
      extractedName: "林清",
      normalizedName: "林清",
      occurrences: 1,
      firstOffset: 0,
      otherOffsets: [],
      matchedAssetId: "c_manual",
      matchedAssetName: "手动角色",
      matchedAssetRevision: null,
      confidence: "high",
      matchSource: "manual",
      resolution: "matched",
      locked: false,
      confirmed: true,
      revision: 2,
    };
    const locked: AssetMatchItem = {
      ...manual,
      id: "match_locked",
      matchSource: "auto",
      locked: true,
      confirmed: false,
      matchedAssetId: "c_locked",
      matchedAssetName: "锁定角色",
    };

    const result = runAutoMatch({
      scriptText: script,
      assets,
      existingMatches: [manual, locked],
    });

    const manualResult = result.find((item) => item.id === "match_manual");
    const lockedResult = result.find((item) => item.id === "match_locked");
    expect(manualResult?.matchedAssetId).toBe("c_manual");
    expect(manualResult?.confirmed).toBe(true);
    expect(lockedResult?.matchedAssetId).toBe("c_locked");
    expect(result.every((item) => !item.confirmed || item.id === "match_manual")).toBe(true);
  });

  it("assigns match_* ids for new requirements only", () => {
    const result = runAutoMatch({
      scriptText: "音乐：雨声",
      assets,
      existingMatches: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id.startsWith("match_")).toBe(true);
    expect(result[0]?.confirmed).toBe(false);
  });
});
