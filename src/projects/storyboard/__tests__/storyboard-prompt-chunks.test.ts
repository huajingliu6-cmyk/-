import { describe, expect, it } from "vitest";
import { generateStructuredStoryboard } from "@/projects/storyboard/services/storyboard-generate";
import {
  buildStoryboardPromptChunks,
  splitSceneShotTargets,
  STORYBOARD_PROMPT_CHUNK_SHOT_MAX,
} from "@/projects/storyboard/services/storyboard-prompt-chunks";
import type { AssetMatchItem } from "@/projects/storyboard/types";

describe("storyboard-prompt-chunks", () => {
  const assetMatches: AssetMatchItem[] = [];

  it("keeps short scripts as a single full-script chunk", () => {
    const board = generateStructuredStoryboard({
      scriptText: "场景：雨夜\n林清走来。",
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    // Force fewer than 4 unlocked targets
    const keep = board.scenes.flatMap((s) => s.shots).slice(0, 3);
    for (const scene of board.scenes) {
      for (const shot of scene.shots) {
        if (!keep.some((k) => k.id === shot.id)) {
          shot.promptLocked = true;
        }
      }
    }
    const chunks = buildStoryboardPromptChunks({ storyboard: board });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.useFullScript).toBe(true);
    expect(chunks[0]!.targets.length).toBeLessThan(4);
  });

  it("does not merge shots across primary scenes", () => {
    const board = generateStructuredStoryboard({
      scriptText: [
        "场景：雨夜街道",
        "林清缓步走来。",
        "她停在路口。",
        "",
        "EXT 废弃仓库",
        "她推门而入。",
        "环顾四周。",
      ].join("\n"),
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });
    expect(board.scenes.length).toBeGreaterThanOrEqual(2);
    const chunks = buildStoryboardPromptChunks({ storyboard: board });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => !c.useFullScript)).toBe(true);

    for (const chunk of chunks) {
      const sceneTitles = new Set(chunk.targets.map((t) => t.sceneTitle));
      expect(sceneTitles.size).toBe(1);
    }

    // Later chunks should carry previous ending summary (overlap into summary only).
    if (chunks.length >= 2) {
      expect(chunks[1]!.prevEndingSummary.length).toBeGreaterThan(0);
      expect(chunks[0]!.shotIds.some((id) => chunks[1]!.shotIds.includes(id))).toBe(
        false,
      );
    }
  });

  it("splits long scenes into 2–4 shot sub-chunks", () => {
    const board = generateStructuredStoryboard({
      scriptText: [
        "场景：长走廊",
        "林清走进走廊。",
        "她放慢脚步。",
        "听见回声。",
        "停在门前。",
        "伸手推门。",
        "门轴吱呀作响。",
      ].join("\n"),
      assetMatches,
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "h2",
      userId: "u1",
    });

    // Inflate one scene to >4 unlocked shots if needed.
    const scene = board.scenes[0]!;
    while (scene.shots.length < 6) {
      const base = scene.shots[0]!;
      scene.shots.push({
        ...base,
        id: `${base.id}_extra_${scene.shots.length}`,
        shotNumber: scene.shots.length + 1,
        order: scene.shots.length,
        promptLocked: false,
        locked: false,
      });
    }
    // Lock other scenes so only this long scene is planned.
    for (const other of board.scenes.slice(1)) {
      for (const shot of other.shots) {
        shot.promptLocked = true;
      }
    }

    const chunks = buildStoryboardPromptChunks({ storyboard: board });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.targets.length).toBeLessThanOrEqual(
        STORYBOARD_PROMPT_CHUNK_SHOT_MAX,
      );
      expect(chunk.chunkBody).toContain("【镜头");
    }
    expect(chunks[1]!.prevEndingSummary).toContain("镜");
  });

  it("splitSceneShotTargets never leaves a single orphan when avoidable", () => {
    const fakeTargets = Array.from({ length: 5 }, (_, i) => ({
      shot: {
        id: `s${i}`,
        shotNumber: i + 1,
      } as never,
      sceneTitle: "A",
    }));
    const parts = splitSceneShotTargets(fakeTargets as never, 4);
    expect(parts.every((p) => p.length >= 2)).toBe(true);
    expect(parts.flat().length).toBe(5);
  });
});
