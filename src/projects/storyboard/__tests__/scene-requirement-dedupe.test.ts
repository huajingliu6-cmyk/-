import { describe, expect, it } from "vitest";
import {
  cleanSceneRequirementName,
  consolidateShotSceneRequirements,
  dedupeShotRequirements,
  ensureShotRequirements,
} from "@/projects/storyboard/shot-completeness";
import type { ShotAssetRequirement, StoryboardShot } from "@/projects/storyboard/types";

function sceneReq(
  sourceName: string,
  overrides: Partial<ShotAssetRequirement> = {},
): ShotAssetRequirement {
  return {
    requirementId: `req_${sourceName}`,
    type: "scene",
    sourceName,
    normalizedName: sourceName,
    selectedAssetId: null,
    resolution: "UNRESOLVED",
    manuallyAdded: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("scene requirement dedupe", () => {
  it("strips shot heading noise from scene names", () => {
    expect(
      cleanSceneRequirementName("1-1日 内 诡市第九号当铺人事办公室11"),
    ).toBe("诡市第九号当铺人事办公室");
    expect(cleanSceneRequirementName("诡市第九号当铺人事办公室")).toBe(
      "诡市第九号当铺人事办公室",
    );
  });

  it("merges heading + clean scene rows that share the same asset", () => {
    const merged = dedupeShotRequirements([
      sceneReq("1-1日 内 诡市第九号当铺人事办公室11", {
        requirementId: "req_noisy",
        selectedAssetId: "s_office",
        resolution: "LINKED",
      }),
      sceneReq("诡市第九号当铺人事办公室", {
        requirementId: "req_clean",
        selectedAssetId: "s_office",
        resolution: "LINKED",
      }),
    ]);
    expect(merged.filter((r) => r.type === "scene")).toHaveLength(1);
    expect(merged[0]?.sourceName).toBe("诡市第九号当铺人事办公室");
    expect(merged[0]?.selectedAssetId).toBe("s_office");
    expect(merged[0]?.resolution).toBe("LINKED");
  });

  it("consolidateShotSceneRequirements rewrites shot.requirements", () => {
    const shot = {
      id: "shot_1",
      shotNumber: 1,
      durationSeconds: 5,
      shotSize: "中景",
      cameraAngle: "平视",
      cameraMovement: "固定",
      composition: "",
      visualDescription: "",
      actionDescription: "",
      dialogue: "",
      soundEffect: "",
      music: "",
      shotSummary: "",
      promptDraft: "p",
      videoPrompt: "p",
      lastVideoContentHash: null,
      lastGenerationId: null,
      videoHistoryGenerationIds: [],
      videoContentStale: false,
      requiredCharacters: [],
      requiredProps: [],
      requiredScene: "诡市第九号当铺人事办公室",
      characterAssetIds: [],
      sceneAssetIds: ["s_office"],
      sceneAssetId: "s_office",
      propAssetIds: [],
      audioAssetIds: [],
      requirements: [
        sceneReq("1-1日 内 诡市第九号当铺人事办公室11", {
          requirementId: "req_noisy",
          selectedAssetId: "s_office",
          resolution: "LINKED",
        }),
        sceneReq("诡市第九号当铺人事办公室", {
          requirementId: "req_clean",
          selectedAssetId: "s_office",
          resolution: "LINKED",
        }),
      ],
      manuallyEdited: false,
      promptLocked: false,
      locked: false,
      confirmed: false,
      revision: 1,
      order: 0,
      promptRegenJobId: null,
    } as StoryboardShot;

    const next = consolidateShotSceneRequirements(shot);
    expect(next).not.toBe(shot);
    expect(ensureShotRequirements(next)).toHaveLength(1);
    expect(ensureShotRequirements(next)[0]?.sourceName).toBe(
      "诡市第九号当铺人事办公室",
    );
  });
});
