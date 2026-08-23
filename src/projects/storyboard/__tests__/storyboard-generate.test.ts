import { describe, expect, it } from "vitest";
import {
  generateStructuredStoryboard,
  mergePreserveLockedShots,
} from "@/projects/storyboard/services/storyboard-generate";
import type { AssetMatchItem } from "@/projects/storyboard/types";
import {
  STORYBOARD_VIDEO_DURATION_MAX,
  STORYBOARD_VIDEO_DURATION_MIN,
} from "@/projects/storyboard/storyboard-video-params";

describe("storyboard-generate", () => {
  const assetMatches: AssetMatchItem[] = [
    {
      id: "match_1",
      assetType: "character",
      extractedName: "林清",
      normalizedName: "林清",
      occurrences: 1,
      firstOffset: 0,
      otherOffsets: [],
      matchedAssetId: "c1",
      matchedAssetName: "林清",
      matchedAssetRevision: null,
      confidence: "high",
      matchSource: "auto",
      resolution: "matched",
      locked: false,
      confirmed: false,
      revision: 1,
    },
  ];

  it("generates 2-4 mock scenes with 2-4 shots each", () => {
    const script = [
      "场景：雨夜街道",
      "林清缓步走来。",
      "",
      "EXT 废弃仓库",
      "她停下，望向远处。",
      "",
      "内景/咖啡馆",
      "林清说：「我们到了。」",
    ].join("\n");

    const doc = generateStructuredStoryboard({
      scriptText: script,
      assetMatches,
      sourceScriptHash: "script_hash",
      sourceAssetSnapshotHash: "asset_hash",
      userId: "user_1",
    });

    expect(doc.status).toBe("ready");
    expect(doc.version).toBe(1);
    expect(doc.revision).toBe(1);
    expect(doc.generationJobId?.startsWith("mock_job_")).toBe(true);
    expect(doc.scenes.length).toBeGreaterThanOrEqual(2);
    expect(doc.scenes.length).toBeLessThanOrEqual(4);
    for (const scene of doc.scenes) {
      expect(scene.shots.length).toBeGreaterThanOrEqual(2);
      expect(scene.shots.length).toBeLessThanOrEqual(4);
      for (const shot of scene.shots) {
        expect(shot.promptLocked).toBe(true);
        expect(shot.locked).toBe(false);
      }
    }
    expect(doc.scenes[0]?.shots[0]?.characterAssetIds).toContain("c1");
    expect(doc.scenes[0]?.shots[0]?.videoPrompt.length).toBeGreaterThan(20);
    // 新分镜不再强制生成 shotSummary；字段可为空以兼容旧数据
    expect(typeof doc.scenes[0]?.shots[0]?.shotSummary).toBe("string");

    for (const scene of doc.scenes) {
      for (const shot of scene.shots) {
        expect(shot.durationSeconds).toBeGreaterThanOrEqual(
          STORYBOARD_VIDEO_DURATION_MIN,
        );
        expect(shot.durationSeconds).toBeLessThanOrEqual(
          STORYBOARD_VIDEO_DURATION_MAX,
        );
      }
    }

    expect(Array.isArray(doc.scenes[0]?.shots[0]?.requiredCharacters)).toBe(
      true,
    );
    const flatNumbers = doc.scenes.flatMap((scene) =>
      scene.shots.map((shot) => shot.shotNumber),
    );
    expect(flatNumbers).toEqual(
      Array.from({ length: flatNumbers.length }, (_, i) => i + 1),
    );
    expect(new Set(flatNumbers).size).toBe(flatNumbers.length);
  });

  it("uses placeholder content when script is empty", () => {
    const doc = generateStructuredStoryboard({
      scriptText: "",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "user_1",
    });
    expect(doc.scenes.length).toBeGreaterThanOrEqual(2);
    expect(doc.sourceScriptHash).toBe("h1");
  });

  it("preserves prompt-locked shots across regenerate", () => {
    const previous = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清出场。",
      assetMatches,
      sourceScriptHash: "a",
      sourceAssetSnapshotHash: "b",
      userId: "user_1",
    });
    const lockedPrompt = "LOCKED_VIDEO_PROMPT";
    previous.scenes[0]!.shots[0] = {
      ...previous.scenes[0]!.shots[0]!,
      promptLocked: true,
      locked: true,
      videoPrompt: lockedPrompt,
      promptDraft: lockedPrompt,
    };

    const generated = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清出场。又一段。",
      assetMatches,
      sourceScriptHash: "a2",
      sourceAssetSnapshotHash: "b2",
      userId: "user_1",
    });
    const merged = mergePreserveLockedShots(previous, generated);
    const shot = merged.scenes[0]?.shots[0];
    expect(shot?.promptLocked).toBe(true);
    expect(shot?.videoPrompt).toBe(lockedPrompt);
  });

  it("keeps shot id and lastGenerationId after regenerate so video history remains", () => {
    const previous = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清出场。",
      assetMatches,
      sourceScriptHash: "a",
      sourceAssetSnapshotHash: "b",
      userId: "user_1",
    });
    const originalId = previous.scenes[0]!.shots[0]!.id;
    previous.scenes[0]!.shots[0] = {
      ...previous.scenes[0]!.shots[0]!,
      lastGenerationId: "gen_keep_me",
      lastVideoContentHash: "h123",
      videoHistoryGenerationIds: ["gen_keep_me"],
      videoContentStale: false,
    };

    const generated = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清出场。剧本已改。",
      assetMatches,
      sourceScriptHash: "a3",
      sourceAssetSnapshotHash: "b3",
      userId: "user_1",
    });
    const merged = mergePreserveLockedShots(previous, generated);
    const shot = merged.scenes[0]?.shots[0];
    expect(shot?.id).toBe(originalId);
    expect(shot?.lastGenerationId).toBe("gen_keep_me");
    expect(shot?.lastVideoContentHash).toBe("h123");
    expect(shot?.videoContentStale).toBe(true);
    expect(merged.videoHistoryGenerationIds).toContain("gen_keep_me");
    expect(shot?.videoHistoryGenerationIds).toContain("gen_keep_me");
  });
});
