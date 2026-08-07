import { describe, expect, it } from "vitest";
import {
  autoLinkShotToLibrary,
  collectLibraryNamesInText,
  findBestAssetIdForRequirementName,
  storyboardNeedsLibraryRematch,
} from "@/projects/storyboard/services/shot-library-match";
import { generateStructuredStoryboard } from "@/projects/storyboard/services/storyboard-generate";
import { buildRequirementsFromNames } from "@/projects/storyboard/shot-completeness";
import type { StoryboardShot } from "@/projects/storyboard/types";

const assets = {
  characters: [
    {
      id: "c1",
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
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "draft" as const,
    },
  ],
  scenes: [
    {
      id: "s1",
      name: "雨夜茶馆",
      projectId: "p1",
      sceneType: "",
      description: "",
      timeOfDay: "",
      location: "茶馆厢房",
      style: "",
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "draft" as const,
    },
  ],
  props: [
    {
      id: "p1",
      name: "旧雨伞",
      projectId: "p1",
      propType: "",
      usage: "",
      description: "",
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "draft" as const,
    },
  ],
  audios: [],
};

function baseShot(overrides?: Partial<StoryboardShot>): StoryboardShot {
  const requirements = buildRequirementsFromNames({
    characters: ["林清"],
    props: ["旧雨伞"],
    scene: "雨夜茶馆",
    stableIds: true,
  });
  return {
    id: "shot_1",
    shotNumber: 1,
    durationSeconds: 3,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "固定",
    composition: "",
    visualDescription: "林清撑着旧雨伞走进雨夜茶馆",
    actionDescription: "",
    dialogue: "",
    soundEffect: "",
    music: "",
    shotSummary: "",
    promptDraft: "提示词",
    videoPrompt: "提示词",
    lastVideoContentHash: null,
    lastGenerationId: null,
    videoHistoryGenerationIds: [],
    videoContentStale: false,
    requiredCharacters: ["林清"],
    requiredProps: ["旧雨伞"],
    requiredScene: "雨夜茶馆",
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
    order: 0,
    promptRegenJobId: null,
    ...overrides,
  };
}

describe("shot-library-match", () => {
  it("collects library names that appear in text", () => {
    const found = collectLibraryNamesInText(
      "林清撑着旧雨伞走进茶馆厢房",
      assets,
    );
    expect(found.characters).toContain("林清");
    expect(found.props).toContain("旧雨伞");
    expect(found.scenes).toContain("雨夜茶馆");
  });

  it("auto-links unresolved requirements to library assets", () => {
    const linked = autoLinkShotToLibrary(baseShot(), assets);
    expect(linked.characterAssetIds).toContain("c1");
    expect(linked.propAssetIds).toContain("p1");
    expect(linked.sceneAssetId).toBe("s1");
    expect(
      linked.requirements.every(
        (r) => r.resolution === "LINKED" && Boolean(r.selectedAssetId),
      ),
    ).toBe(true);
  });

  it("does not override NOT_REQUIRED", () => {
    const shot = baseShot();
    shot.requirements = shot.requirements.map((r) =>
      r.type === "prop"
        ? { ...r, resolution: "NOT_REQUIRED" as const, selectedAssetId: null }
        : r,
    );
    const linked = autoLinkShotToLibrary(shot, assets);
    const propReq = linked.requirements.find((r) => r.type === "prop");
    expect(propReq?.resolution).toBe("NOT_REQUIRED");
    expect(linked.propAssetIds).not.toContain("p1");
  });

  it("matches scene by location alias", () => {
    const shot = baseShot({
      requiredScene: "茶馆厢房",
      requirements: buildRequirementsFromNames({
        characters: [],
        props: [],
        scene: "茶馆厢房",
        stableIds: true,
      }),
    });
    const linked = autoLinkShotToLibrary(shot, assets);
    expect(linked.sceneAssetId).toBe("s1");
  });

  it("findBestAssetIdForRequirementName uses shared matcher", () => {
    expect(
      findBestAssetIdForRequirementName("林清", "character", assets.characters),
    ).toBe("c1");
    expect(
      findBestAssetIdForRequirementName("雨夜", "scene", assets.scenes),
    ).toBe("s1");
  });

  it("autoLinkShotFromPickerAssets links scene requirement from picker list", async () => {
    const { autoLinkShotFromPickerAssets } = await import(
      "@/projects/storyboard/services/shot-library-match"
    );
    const shot = baseShot({
      requiredScene: "诡市第九号当铺人事办公室",
      requiredCharacters: [],
      requiredProps: [],
      requirements: buildRequirementsFromNames({
        characters: [],
        props: [],
        scene: "1-1日 内 诡市第九号当铺人事办公室11",
        stableIds: true,
      }),
    });
    const next = autoLinkShotFromPickerAssets(shot, [
      { id: "s1", name: "雨夜茶馆", kind: "scene" },
      { id: "s2", name: "诡市第九号当铺", kind: "scene" },
      { id: "c1", name: "林清", kind: "character" },
    ]);
    expect(next.sceneAssetId).toBe("s2");
    expect(
      next.requirements.find((r) => r.type === "scene")?.resolution,
    ).toBe("LINKED");
  });

  it("generateStructuredStoryboard binds library assets per shot", () => {
    const doc = generateStructuredStoryboard({
      scriptText: [
        "场景：雨夜茶馆",
        "林清出场，撑着旧雨伞走进门。",
        "",
        "林清说：「今晚别走水路。」",
      ].join("\n"),
      assetMatches: [],
      libraryAssets: assets,
      sourceScriptHash: "s",
      sourceAssetSnapshotHash: "a",
      userId: "u1",
    });

    const shots = doc.scenes.flatMap((scene) => scene.shots);
    const withChar = shots.find((s) =>
      s.requiredCharacters.some((n) => n.includes("林清")),
    );
    expect(withChar).toBeTruthy();
    expect(withChar?.characterAssetIds).toContain("c1");

    const withProp = shots.find((s) =>
      s.requiredProps.some((n) => n.includes("伞")),
    );
    expect(withProp?.propAssetIds.includes("p1") || withProp?.requirements.some(
      (r) => r.type === "prop" && r.selectedAssetId === "p1",
    )).toBe(true);
  });

  it("storyboardNeedsLibraryRematch detects unresolved vs fully linked boards", () => {
    const unresolved = baseShot();
    const linked = autoLinkShotToLibrary(unresolved, assets);
    const wrap = (shot: StoryboardShot) =>
      ({
        id: "sb1",
        projectId: "p1",
        episodeId: "e1",
        status: "draft",
        revision: 1,
        sourceScriptHash: "",
        sourceAssetSnapshotHash: "",
        generationJobId: null,
        createdAt: "",
        updatedAt: "",
        scenes: [
          {
            id: "sc1",
            title: "茶馆",
            location: "茶馆",
            order: 0,
            shots: [shot],
          },
        ],
      }) as const;

    expect(storyboardNeedsLibraryRematch(wrap(unresolved))).toBe(true);
    expect(storyboardNeedsLibraryRematch(wrap(linked))).toBe(false);
  });
});
