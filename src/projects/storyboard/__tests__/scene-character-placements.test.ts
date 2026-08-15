import { describe, expect, it } from "vitest";
import {
  buildSceneCharacterPlacementPrompt,
  parseSceneCharacterPlacements,
  placementsFingerprintPayload,
  pruneSceneCharacterPlacements,
} from "@/projects/storyboard/scene-character-placements";
import { computeShotVideoContentHash } from "@/projects/storyboard/shot-completeness";
import type { StoryboardShot } from "@/projects/storyboard/types";

function baseShot(
  overrides: Partial<StoryboardShot> = {},
): StoryboardShot {
  return {
    id: "shot_1",
    shotNumber: 1,
    order: 0,
    durationSeconds: 4,
    characterAssetIds: ["char_a", "char_b"],
    propAssetIds: [],
    sceneAssetIds: ["scene_1"],
    sceneAssetId: "scene_1",
    requirements: [],
    revision: 1,
    locked: false,
    promptLocked: false,
    manuallyEdited: false,
    ...overrides,
  } as StoryboardShot;
}

describe("scene character placements", () => {
  it("parses and clamps coordinates to 0..1", () => {
    const parsed = parseSceneCharacterPlacements(
      [
        { characterAssetId: "char_a", x: -0.2, y: 1.5 },
        { characterAssetId: "char_b", x: 0.5, y: 0.25, depth: 1 },
      ],
      ["char_a", "char_b"],
    );
    expect(parsed).toEqual([
      { characterAssetId: "char_a", x: 0, y: 1 },
      { characterAssetId: "char_b", x: 0.5, y: 0.25, depth: 1 },
    ]);
  });

  it("rejects unknown characters and oversized lists", () => {
    expect(
      parseSceneCharacterPlacements(
        [{ characterAssetId: "char_x", x: 0.1, y: 0.2 }],
        ["char_a"],
      ),
    ).toBeNull();
    expect(
      parseSceneCharacterPlacements(
        Array.from({ length: 51 }, (_, i) => ({
          characterAssetId: "char_a",
          x: 0.1,
          y: i / 100,
        })),
        ["char_a"],
      ),
    ).toBeNull();
  });

  it("prunes placements when characters are removed", () => {
    expect(
      pruneSceneCharacterPlacements(
        [
          { characterAssetId: "char_a", x: 0.2, y: 0.3 },
          { characterAssetId: "char_b", x: 0.7, y: 0.4 },
        ],
        ["char_a"],
      ),
    ).toEqual([{ characterAssetId: "char_a", x: 0.2, y: 0.3 }]);
  });

  it("builds placement prompt without overwriting user edit text", () => {
    const prompt = buildSceneCharacterPlacementPrompt(
      [
        { characterAssetId: "char_a", x: 0.35, y: 0.72 },
        { characterAssetId: "char_b", x: 0.68, y: 0.6, depth: 1 },
      ],
      [
        { id: "char_a", name: "林清" },
        { id: "char_b", name: "周野" },
      ],
    );
    expect(prompt).toContain("角色位置约束：");
    expect(prompt).toContain("林清");
    expect(prompt).toContain("周野");
    expect(prompt).toContain("x=0.35");
    expect(prompt).toContain("保持人物与场景透视");
  });

  it("changes video content fingerprint when placements change", () => {
    const without = computeShotVideoContentHash(baseShot());
    const withPlacements = computeShotVideoContentHash(
      baseShot({
        sceneCharacterPlacements: [
          { characterAssetId: "char_a", x: 0.2, y: 0.8 },
        ],
      }),
    );
    expect(withPlacements).not.toBe(without);
    expect(placementsFingerprintPayload(undefined)).toBe("");
    expect(
      computeShotVideoContentHash(
        baseShot({ sceneCharacterPlacements: undefined }),
      ),
    ).toBe(without);
  });
});
