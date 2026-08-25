import { describe, expect, it } from "vitest";
import {
  extractCharacterNamesFromText,
  extractRequirements,
  isUsableCharacterName,
  matchAssetByName,
  runAutoMatch,
  sanitizeAssetMatchItems,
  sanitizeShotCharacterRequirements,
  splitCharacterNameList,
} from "@/projects/storyboard/services/asset-match";
import { buildRequirementsFromNames } from "@/projects/storyboard/shot-completeness";
import type { AssetMatchItem, StoryboardShot } from "@/projects/storyboard/types";

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
      "韩兆丰：你来了。",
      "道具：旧雨伞",
      "音效：雨声",
    ].join("\n");

    const reqs = extractRequirements(script);
    expect(reqs.some((r) => r.assetType === "character" && r.extractedName.includes("林清"))).toBe(true);
    expect(reqs.some((r) => r.assetType === "character" && r.extractedName.includes("韩兆丰"))).toBe(true);
    expect(reqs.some((r) => r.assetType === "scene" && r.extractedName.includes("雨夜"))).toBe(true);
    expect(reqs.some((r) => r.assetType === "prop" && r.extractedName.includes("旧雨伞"))).toBe(true);
    expect(reqs.some((r) => r.assetType === "audio" && r.extractedName.includes("雨声"))).toBe(true);
    expect(reqs.some((r) => r.extractedName === "人物")).toBe(false);
  });

  it("parses 人物/角色 roster lines into real names, not labels", () => {
    expect(extractCharacterNamesFromText("人物：韩兆丰")).toEqual(["韩兆丰"]);
    expect(extractCharacterNamesFromText("角色：韩兆丰、范德维奇")).toEqual(
      expect.arrayContaining(["韩兆丰", "范德维奇"]),
    );
    expect(extractCharacterNamesFromText("人物：无")).toEqual([]);
    expect(extractCharacterNamesFromText("场景：客厅")).not.toContain("场景");
    expect(extractCharacterNamesFromText("对白：你来了")).not.toContain("对白");
    expect(extractCharacterNamesFromText("韩兆丰：你来了")).toEqual(["韩兆丰"]);
    expect(extractCharacterNamesFromText("人物进入画面")).not.toContain("人物");
    expect(extractCharacterNamesFromText("人物：韩兆丰（男，55岁）")).toEqual([
      "韩兆丰",
    ]);
  });

  it("does not treat field labels as usable character names", () => {
    expect(isUsableCharacterName("人物")).toBe(false);
    expect(isUsableCharacterName("角色")).toBe(false);
    expect(isUsableCharacterName("韩兆丰")).toBe(true);
    expect(splitCharacterNameList("韩兆丰、范德维奇")).toEqual([
      "韩兆丰",
      "范德维奇",
    ]);
  });

  it("extractCharacterNamesFromText recognizes colon dialogue speakers", () => {
    expect(extractCharacterNamesFromText("韩兆丰：你来了。")).toContain("韩兆丰");
    expect(extractCharacterNamesFromText("韩兆丰进入画面，望向窗外。")).toEqual(
      expect.arrayContaining(["韩兆丰"]),
    );
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

  it("drops dirty label matches from existing assetMatches", () => {
    const dirty: AssetMatchItem = {
      id: "match_dirty",
      assetType: "character",
      extractedName: "人物",
      normalizedName: "人物",
      occurrences: 1,
      firstOffset: 0,
      otherOffsets: [],
      matchedAssetId: null,
      matchedAssetName: null,
      matchedAssetRevision: null,
      confidence: "none",
      matchSource: "auto",
      resolution: "unresolved",
      locked: false,
      confirmed: false,
      revision: 1,
    };
    expect(sanitizeAssetMatchItems([dirty])).toEqual([]);
    const result = runAutoMatch({
      scriptText: "人物：韩兆丰\n韩兆丰：你来了。",
      assets: {
        ...assets,
        characters: [
          {
            ...assets.characters[0]!,
            id: "c_han",
            name: "韩兆丰",
          },
        ],
      },
      existingMatches: [dirty],
    });
    expect(result.some((item) => item.extractedName === "人物")).toBe(false);
    expect(result.some((item) => item.extractedName === "韩兆丰")).toBe(true);
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

  it("sanitizes dirty requiredCharacters labels and recovers real names from text", () => {
    const requirements = buildRequirementsFromNames({
      characters: ["人物", "韩兆丰"],
      props: [],
      scene: null,
      stableIds: true,
    });
    const shot: StoryboardShot = {
      id: "shot_3",
      shotNumber: 3,
      durationSeconds: 4,
      shotSize: "中景",
      cameraAngle: "平视",
      cameraMovement: "固定",
      composition: "",
      visualDescription: "人物：韩兆丰\n韩兆丰推门进入。",
      actionDescription: "",
      dialogue: "",
      soundEffect: "",
      music: "",
      shotSummary: "",
      promptDraft: "",
      videoPrompt: "",
      lastVideoContentHash: null,
      lastGenerationId: null,
      videoHistoryGenerationIds: [],
      videoContentStale: false,
      requiredCharacters: ["人物", "韩兆丰"],
      requiredProps: [],
      requiredScene: null,
      characterAssetIds: [],
      sceneAssetIds: [],
      sceneAssetId: null,
      propAssetIds: [],
      audioAssetIds: [],
      requirements,
      manuallyEdited: false,
      promptLocked: false,
      locked: false,
      confirmed: false,
      revision: 1,
      order: 3,
      promptRegenJobId: null,
    };

    const cleaned = sanitizeShotCharacterRequirements(shot);
    expect(cleaned.requiredCharacters).toEqual(["韩兆丰"]);
    expect(
      cleaned.requirements?.some(
        (req) => req.type === "character" && req.sourceName === "人物",
      ),
    ).toBe(false);
    expect(
      cleaned.requirements?.some(
        (req) => req.type === "character" && req.sourceName === "韩兆丰",
      ),
    ).toBe(true);
  });
});
