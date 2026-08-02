import { describe, expect, it } from "vitest";
import { canNavigateToStep } from "@/projects/storyboard/components/CreationStepHeader";
import {
  CREATION_STEP_LABEL,
  normalizeCreationStep,
  type EpisodeProduction,
} from "@/projects/storyboard/types";
import {
  areShotAssetsComplete,
  getShotCompletenessStatus,
  isShotConfirmReady,
  listFlatShots,
} from "@/projects/storyboard/shot-completeness";
import type { StoryboardShot } from "@/projects/storyboard/types";

function baseShot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    id: "shot_1",
    shotNumber: 1,
    durationSeconds: 3,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "固定",
    composition: "",
    visualDescription: "画面",
    actionDescription: "",
    dialogue: "",
    soundEffect: "",
    music: "",
    shotSummary: "林清撑伞走过雨夜老街。",
    promptDraft: "",
    videoPrompt: "完整视频提示词",
    lastVideoContentHash: null,
    lastGenerationId: null,
    videoHistoryGenerationIds: [],
    videoContentStale: false,
    requiredCharacters: ["林清"],
    requiredProps: ["伞"],
    requiredScene: "老街",
    characterAssetIds: [],
    sceneAssetIds: [],
    sceneAssetId: null,
    propAssetIds: [],
    audioAssetIds: [],
    requirements: [],
    manuallyEdited: false,
    promptLocked: false,
    locked: false,
    confirmed: false,
    revision: 1,
    order: 0,
    promptRegenJobId: null,
    ...overrides,
  };
}

function baseProduction(
  overrides: Partial<EpisodeProduction> = {},
): EpisodeProduction {
  const now = new Date().toISOString();
  return {
    id: "prod1",
    projectId: "p1",
    episodeId: "ep1",
    episodeNumber: 1,
    currentStep: 2,
    status: "awaiting_storyboard",
    workingScriptText: "剧本",
    workingScriptRevision: 1,
    confirmedScriptText: "剧本",
    confirmedScriptRevision: 1,
    confirmedScriptHash: "h",
    scriptConfirmedAt: now,
    scriptConfirmedBy: "u1",
    assetMatches: [],
    confirmedAssetSnapshotHash: null,
    assetsConfirmedAt: null,
    assetsConfirmedBy: null,
    assetsStale: false,
    storyboardStale: false,
    activeStoryboard: null,
    generationError: null,
    videoGenerationBatch: null,
    revision: 1,
    lastEditedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("storyboard creation two-step flow helpers", () => {
  it("exposes only two creation step labels", () => {
    expect(Object.keys(CREATION_STEP_LABEL)).toEqual(["1", "2"]);
    expect(CREATION_STEP_LABEL[1]).toBe("选择剧集");
    expect(CREATION_STEP_LABEL[2]).toBe("分镜创作");
    expect(Object.values(CREATION_STEP_LABEL).join("")).not.toContain(
      "资产匹配",
    );
  });

  it("normalizes legacy step 3 and asset-matching productions to step 2", () => {
    expect(normalizeCreationStep(3)).toBe(2);
    expect(normalizeCreationStep(2)).toBe(2);
    const production = baseProduction({
      currentStep: 2,
      status: "awaiting_asset_match",
    });
    expect(canNavigateToStep(production, 1)).toBe(true);
    expect(canNavigateToStep(production, 2)).toBe(true);
  });

  it("marks shots missing assets as incomplete", () => {
    const shot = baseShot();
    expect(areShotAssetsComplete(shot)).toBe(false);
    expect(getShotCompletenessStatus(shot)).toBe("needs_assets");
    expect(isShotConfirmReady(shot)).toBe(false);
  });

  it("marks shots complete when requirements are LINKED", () => {
    const now = new Date().toISOString();
    const shot = baseShot({
      characterAssetIds: ["c1"],
      propAssetIds: ["p1"],
      sceneAssetId: "s1",
      sceneAssetIds: ["s1"],
      requirements: [
        {
          requirementId: "r1",
          type: "character",
          sourceName: "林清",
          normalizedName: "林清",
          selectedAssetId: "c1",
          resolution: "LINKED",
          manuallyAdded: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          requirementId: "r2",
          type: "prop",
          sourceName: "伞",
          normalizedName: "伞",
          selectedAssetId: "p1",
          resolution: "LINKED",
          manuallyAdded: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          requirementId: "r3",
          type: "scene",
          sourceName: "老街",
          normalizedName: "老街",
          selectedAssetId: "s1",
          resolution: "LINKED",
          manuallyAdded: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    expect(areShotAssetsComplete(shot)).toBe(true);
    expect(getShotCompletenessStatus(shot)).toBe("complete");
    expect(isShotConfirmReady(shot)).toBe(true);
  });

  it("treats NOT_REQUIRED requirements as satisfied", () => {
    const now = new Date().toISOString();
    const shot = baseShot({
      requiredCharacters: ["路人甲"],
      requiredProps: [],
      requiredScene: null,
      requirements: [
        {
          requirementId: "r1",
          type: "character",
          sourceName: "路人甲",
          normalizedName: "路人甲",
          selectedAssetId: null,
          resolution: "NOT_REQUIRED",
          manuallyAdded: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    expect(areShotAssetsComplete(shot)).toBe(true);
  });

  it("lists shots in scene then shot order", () => {
    const rows = listFlatShots([
      {
        sceneNumber: 2,
        title: "B",
        shots: [
          baseShot({ id: "s2-2", shotNumber: 2, order: 1 }),
          baseShot({ id: "s2-1", shotNumber: 1, order: 0 }),
        ],
      },
      {
        sceneNumber: 1,
        title: "A",
        shots: [baseShot({ id: "s1-1", shotNumber: 1, order: 0 })],
      },
    ]);
    expect(rows.map((r) => r.shot.id)).toEqual(["s1-1", "s2-1", "s2-2"]);
  });

  it("opens legacy shots missing new fields without crashing", () => {
    const legacy = baseShot({
      videoPrompt: "",
      promptDraft: "旧提示词",
      requiredCharacters: undefined as unknown as string[],
      requiredProps: undefined as unknown as string[],
      requiredScene: undefined as unknown as string | null,
      requirements: undefined as unknown as [],
      sceneAssetId: undefined as unknown as string | null,
    });
    // normalize via getShotVideoPrompt path
    expect(getShotCompletenessStatus({
      ...legacy,
      requiredCharacters: legacy.requiredCharacters ?? [],
      requiredProps: legacy.requiredProps ?? [],
      requiredScene: legacy.requiredScene ?? null,
      requirements: legacy.requirements ?? [],
      sceneAssetId: legacy.sceneAssetId ?? null,
      videoPrompt: legacy.videoPrompt || legacy.promptDraft,
    })).toBe("complete");
  });
});
