import { describe, expect, it } from "vitest";
import { ensureStoryboardCharacterBindings } from "@/projects/storyboard/services/ensure-storyboard-character-bindings";
import {
  shotRequiresCharacterAssetBinding,
  validateShotCharacterAssetBindings,
} from "@/projects/storyboard/services/storyboard-clip-mount";
import { buildRequirementsFromNames } from "@/projects/storyboard/shot-completeness";
import type {
  StoryboardDocument,
  StoryboardShot,
} from "@/projects/storyboard/types";

const libraryAssets = {
  characters: [
    {
      id: "c_linqing",
      name: "林清",
      projectId: "p1",
      role: "",
      description: "",
      appearance: "",
      clothing: "",
      age: "",
      gender: "",
      voiceId: null,
      voiceName: null,
      voiceStyle: null,
      imageFileName: "linqing.png",
      imageObjectUrl: null,
      imageMimeType: "image/png",
      status: "draft" as const,
    },
  ],
  scenes: [],
  props: [],
  audios: [],
};

function baseShot(overrides?: Partial<StoryboardShot>): StoryboardShot {
  const requirements = buildRequirementsFromNames({
    characters: ["林清"],
    props: [],
    scene: null,
    stableIds: true,
  });
  return {
    id: "shot_3",
    shotNumber: 3,
    durationSeconds: 4,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "固定",
    composition: "",
    visualDescription: "林清推门进入",
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
    requiredCharacters: ["林清"],
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
    ...overrides,
  };
}

function storyboardFromShot(shot: StoryboardShot): StoryboardDocument {
  return {
    id: "sb1",
    version: 1,
    status: "draft",
    sourceScriptHash: "",
    sourceAssetSnapshotHash: "",
    scenes: [
      {
        id: "sc1",
        sceneNumber: 1,
        title: "场景1",
        location: "",
        timeOfDay: "",
        interiorExterior: "未知",
        summary: "",
        characterAssetIds: [],
        sceneAssetIds: [],
        propAssetIds: [],
        order: 1,
        shots: [shot],
        confirmed: false,
      },
    ],
    generationJobId: null,
    videoHistoryGenerationIds: [],
    confirmedAt: null,
    confirmedBy: null,
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "u1",
  };
}

describe("ensureStoryboardCharacterBindings", () => {
  it("binds requiredCharacters to library characterAssetIds before LLM", () => {
    const result = ensureStoryboardCharacterBindings({
      storyboard: storyboardFromShot(baseShot()),
      libraryAssets,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shot = result.storyboard.scenes[0]!.shots[0]!;
    expect(shot.characterAssetIds).toEqual(["c_linqing"]);
    expect(
      shot.requirements?.some(
        (req) =>
          req.type === "character" &&
          req.selectedAssetId === "c_linqing" &&
          req.resolution === "LINKED",
      ),
    ).toBe(true);
  });

  it("allows empty library when shot needs characters (soft warning)", () => {
    const result = ensureStoryboardCharacterBindings({
      storyboard: storyboardFromShot(baseShot()),
      libraryAssets: { characters: [], scenes: [], props: [], audios: [] },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]?.code).toBe("CHARACTER_BINDING_INCOMPLETE");
  });

  it("allows unmatched character name with soft warning", () => {
    const result = ensureStoryboardCharacterBindings({
      storyboard: storyboardFromShot(
        baseShot({
          requiredCharacters: ["不存在的角色"],
          requirements: buildRequirementsFromNames({
            characters: ["不存在的角色"],
            props: [],
            scene: null,
            stableIds: true,
          }),
        }),
      ),
      libraryAssets,
    });
    expect(result.ok).toBe(true);
    expect(result.storyboard.scenes[0]!.shots[0]!.characterAssetIds).toEqual([]);
    expect(result.warnings.some((w) => w.message.includes("不存在的角色"))).toBe(
      true,
    );
  });
  it("allows dialogue-only shots without character bindings", () => {
    const shot = baseShot({
      requiredCharacters: [],
      characterAssetIds: [],
      requirements: [],
      dialogue: "有人在说话",
    });
    expect(shotRequiresCharacterAssetBinding(shot)).toBe(false);
    expect(
      validateShotCharacterAssetBindings({ shot, libraryAssets }),
    ).toEqual([]);

    const result = ensureStoryboardCharacterBindings({
      storyboard: storyboardFromShot(shot),
      libraryAssets: { characters: [], scenes: [], props: [], audios: [] },
    });
    expect(result.ok).toBe(true);
  });

  it("strips dirty label「人物」and binds real name from shot text", () => {
    const dirty = baseShot({
      requiredCharacters: ["人物"],
      visualDescription: "人物：林清\n林清推门进入。",
      requirements: buildRequirementsFromNames({
        characters: ["人物"],
        props: [],
        scene: null,
        stableIds: true,
      }),
    });
    const result = ensureStoryboardCharacterBindings({
      storyboard: storyboardFromShot(dirty),
      libraryAssets,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shot = result.storyboard.scenes[0]!.shots[0]!;
    expect(shot.requiredCharacters).toEqual(["林清"]);
    expect(shot.characterAssetIds).toEqual(["c_linqing"]);
    expect(
      shot.requirements?.some(
        (req) => req.type === "character" && req.sourceName === "人物",
      ),
    ).toBe(false);
  });
});
