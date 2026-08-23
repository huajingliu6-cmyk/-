import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import { deleteLibraryAsset } from "@/projects/assets/delete-library-asset";
import { unlinkAssetFromStoryboardWorkspace } from "@/projects/assets/delete-library-asset";
import { analyzeAssetReferenceImpact } from "@/projects/assets/asset-reference-impact";
import type { CharacterAsset, PropAsset, SceneAsset } from "@/projects/assets/types";
import {
  loadWorkspace,
  saveWorkspace,
} from "@/projects/storyboard/production-store";
import type {
  ProjectStoryboardWorkspace,
  StoryboardShot,
} from "@/projects/storyboard/types";
import { saveWorkspaceLocalAssets } from "@/projects/workspace-sync/store";

vi.mock("@/projects/assets/asset-draft-downstream", () => ({
  synchronizeAssetDraftDownstream: vi.fn(async () => ({ deferred: false })),
  synchronizeAssetMediaDownstream: vi.fn(async () => undefined),
}));

vi.mock("@/projects/assets/asset-image-storage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/projects/assets/asset-image-storage")>();
  return {
    ...actual,
    deleteProjectAssetImageFile: vi.fn(async () => {
      throw new Error("deleteProjectAssetImageFile must not be called");
    }),
  };
});

const PNG_HINT = "blob-must-remain";

function baseCharacter(
  projectId: string,
  overrides: Partial<CharacterAsset> = {},
): CharacterAsset {
  return {
    id: "char_1",
    projectId,
    name: "林清",
    role: "女主",
    description: "",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: null,
    voiceName: null,
    voiceStyle: null,
    imageFileName: "char_1",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "completed",
    primaryMediaId: "char_1",
    approvedMediaIds: ["char_1"],
    historyMediaIds: [],
    lookMediaIds: [],
    ...overrides,
  };
}

function baseScene(
  projectId: string,
  overrides: Partial<SceneAsset> = {},
): SceneAsset {
  return {
    id: "scene_lib_1",
    projectId,
    name: "咖啡馆",
    sceneType: "",
    description: "",
    timeOfDay: "",
    location: "",
    style: "",
    imageFileName: "scene_lib_1",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "completed",
    primaryMediaId: "scene_lib_1",
    approvedMediaIds: ["scene_lib_1"],
    ...overrides,
  };
}

function baseProp(
  projectId: string,
  overrides: Partial<PropAsset> = {},
): PropAsset {
  return {
    id: "prop_1",
    projectId,
    name: "雨伞",
    propType: "",
    description: "",
    usage: "",
    imageFileName: "prop_1",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "completed",
    primaryMediaId: "prop_1",
    approvedMediaIds: ["prop_1"],
    ...overrides,
  };
}

function baseShot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    id: "shot_1",
    shotNumber: 1,
    order: 0,
    durationSeconds: 4,
    shotSize: "",
    cameraAngle: "",
    cameraMovement: "",
    composition: "",
    visualDescription: "",
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
    requiredCharacters: [],
    requiredProps: [],
    requiredScene: null,
    characterAssetIds: ["char_1", "char_keep"],
    sceneAssetIds: ["scene_lib_1"],
    sceneAssetId: "scene_lib_1",
    propAssetIds: ["prop_1", "prop_keep"],
    audioAssetIds: [],
    assetMediaIds: {
      char_1: "char_1",
      char_keep: "media_keep",
      prop_1: "prop_1",
    },
    sceneCharacterPlacements: [
      { characterAssetId: "char_1", x: 0.2, y: 0.3 },
      { characterAssetId: "char_keep", x: 0.8, y: 0.4 },
    ],
    requirements: [
      {
        requirementId: "req_char",
        type: "character",
        sourceName: "林清",
        normalizedName: "林清",
        selectedAssetId: "char_1",
        resolution: "LINKED",
        manuallyAdded: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        requirementId: "req_keep",
        type: "character",
        sourceName: "保留",
        normalizedName: "保留",
        selectedAssetId: "char_keep",
        resolution: "LINKED",
        manuallyAdded: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    manuallyEdited: false,
    promptLocked: false,
    locked: false,
    confirmed: false,
    revision: 1,
    promptRegenJobId: null,
    ...overrides,
  };
}

function workspaceWithRefs(projectId: string): ProjectStoryboardWorkspace {
  return {
    projectId,
    activeEpisodeId: "ep_1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    productions: [
      {
        id: "prod_1",
        projectId,
        episodeId: "ep_1",
        episodeNumber: 1,
        currentStep: 2,
        status: "storyboard_review",
        workingScriptText: "正文",
        workingScriptRevision: 1,
        confirmedScriptText: "正文",
        confirmedScriptRevision: 1,
        confirmedScriptHash: "hash",
        scriptConfirmedAt: "2026-01-01T00:00:00.000Z",
        scriptConfirmedBy: "u1",
        assetMatches: [
          {
            id: "match_1",
            assetType: "character",
            extractedName: "林清",
            normalizedName: "林清",
            occurrences: 1,
            firstOffset: 0,
            otherOffsets: [],
            matchedAssetId: "char_1",
            matchedAssetName: "林清",
            matchedAssetRevision: 1,
            confidence: "high",
            matchSource: "manual",
            resolution: "matched",
            locked: false,
            confirmed: true,
            revision: 1,
          },
          {
            id: "match_keep",
            assetType: "character",
            extractedName: "保留",
            normalizedName: "保留",
            occurrences: 1,
            firstOffset: 1,
            otherOffsets: [],
            matchedAssetId: "char_keep",
            matchedAssetName: "保留",
            matchedAssetRevision: 1,
            confidence: "high",
            matchSource: "manual",
            resolution: "matched",
            locked: false,
            confirmed: true,
            revision: 1,
          },
        ],
        confirmedAssetSnapshotHash: null,
        assetsConfirmedAt: null,
        assetsConfirmedBy: null,
        assetsStale: false,
        storyboardStale: false,
        activeStoryboard: {
          id: "sb_1",
          status: "draft",
          revision: 1,
          version: 1,
          sourceScriptHash: "",
          sourceAssetSnapshotHash: "",
          generationJobId: null,
          videoHistoryGenerationIds: [],
          confirmedAt: null,
          confirmedBy: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          scenes: [
            {
              id: "sc_1",
              sceneNumber: 1,
              title: "开场",
              location: "",
              timeOfDay: "",
              interiorExterior: "未知",
              summary: "",
              characterAssetIds: ["char_1", "char_keep"],
              sceneAssetIds: ["scene_lib_1"],
              propAssetIds: ["prop_1", "prop_keep"],
              order: 0,
              confirmed: false,
              shots: [baseShot()],
            },
          ],
        },
        generationError: null,
        videoGenerationBatch: null,
        revision: 1,
        lastEditedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

describe("library asset delete reference protection", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-asset-del-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("deletes unreferenced character/scene/prop without calling blob delete", async () => {
    const projectId = "p_del_free";
    await saveAssetBundleDraft({
      projectId,
      characters: [baseCharacter(projectId)],
      scenes: [baseScene(projectId)],
      props: [baseProp(projectId)],
      audios: [],
    });
    void PNG_HINT;

    for (const kind of ["character", "scene", "prop"] as const) {
      const assetId =
        kind === "character"
          ? "char_1"
          : kind === "scene"
            ? "scene_lib_1"
            : "prop_1";
      const result = await deleteLibraryAsset({
        projectId,
        scope: "management",
        kind,
        assetId,
        unlinkStoryboardRefs: false,
      });
      expect(result.ok).toBe(true);
    }

    const draft = await loadAssetBundleDraft(projectId);
    expect(draft?.characters).toHaveLength(0);
    expect(draft?.scenes).toHaveLength(0);
    expect(draft?.props).toHaveLength(0);

    const { deleteProjectAssetImageFile } = await import(
      "@/projects/assets/asset-image-storage"
    );
    expect(deleteProjectAssetImageFile).not.toHaveBeenCalled();
  });

  it("default delete returns ASSET_IN_USE and leaves assets + storyboard unchanged", async () => {
    const projectId = "p_del_in_use";
    await saveAssetBundleDraft({
      projectId,
      characters: [
        baseCharacter(projectId),
        baseCharacter(projectId, { id: "char_keep", name: "保留", primaryMediaId: "char_keep", imageFileName: "char_keep", approvedMediaIds: ["char_keep"] }),
      ],
      scenes: [baseScene(projectId)],
      props: [
        baseProp(projectId),
        baseProp(projectId, { id: "prop_keep", name: "保留道具", primaryMediaId: "prop_keep", imageFileName: "prop_keep", approvedMediaIds: ["prop_keep"] }),
      ],
      audios: [],
    });
    await saveWorkspace(workspaceWithRefs(projectId));

    const beforeWs = await loadWorkspace(projectId);
    const beforeDraft = await loadAssetBundleDraft(projectId);

    const result = await deleteLibraryAsset({
      projectId,
      scope: "management",
      kind: "character",
      assetId: "char_1",
      unlinkStoryboardRefs: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ASSET_IN_USE");
    expect(result.impact?.referencedShotCount).toBeGreaterThan(0);

    const afterDraft = await loadAssetBundleDraft(projectId);
    const afterWs = await loadWorkspace(projectId);
    expect(afterDraft?.characters.map((c) => c.id).sort()).toEqual(
      beforeDraft?.characters.map((c) => c.id).sort(),
    );
    expect(afterWs?.productions[0]?.activeStoryboard?.scenes[0]?.shots[0]?.characterAssetIds).toEqual(
      beforeWs?.productions[0]?.activeStoryboard?.scenes[0]?.shots[0]?.characterAssetIds,
    );
  });

  it("unlinkStoryboardRefs clears all reference fields and keeps other assets", async () => {
    const projectId = "p_del_unlink";
    await saveAssetBundleDraft({
      projectId,
      characters: [
        baseCharacter(projectId),
        baseCharacter(projectId, {
          id: "char_keep",
          name: "保留",
          primaryMediaId: "char_keep",
          imageFileName: "char_keep",
          approvedMediaIds: ["char_keep"],
        }),
      ],
      scenes: [baseScene(projectId)],
      props: [
        baseProp(projectId),
        baseProp(projectId, {
          id: "prop_keep",
          name: "保留道具",
          primaryMediaId: "prop_keep",
          imageFileName: "prop_keep",
          approvedMediaIds: ["prop_keep"],
        }),
      ],
      audios: [],
    });
    await saveWorkspace(workspaceWithRefs(projectId));

    const result = await deleteLibraryAsset({
      projectId,
      scope: "management",
      kind: "character",
      assetId: "char_1",
      unlinkStoryboardRefs: true,
    });
    expect(result.ok).toBe(true);

    const draft = await loadAssetBundleDraft(projectId);
    expect(draft?.characters.map((c) => c.id)).toEqual(["char_keep"]);

    const ws = await loadWorkspace(projectId);
    const shot = ws?.productions[0]?.activeStoryboard?.scenes[0]?.shots[0];
    expect(shot?.characterAssetIds).toEqual(["char_keep"]);
    expect(shot?.assetMediaIds).toEqual({ char_keep: "media_keep", prop_1: "prop_1" });
    expect(shot?.sceneCharacterPlacements).toEqual([
      { characterAssetId: "char_keep", x: 0.8, y: 0.4 },
    ]);
    expect(shot?.requirements.find((r) => r.requirementId === "req_char")).toMatchObject({
      selectedAssetId: null,
      resolution: "UNRESOLVED",
    });
    expect(shot?.requirements.find((r) => r.requirementId === "req_keep")).toMatchObject({
      selectedAssetId: "char_keep",
      resolution: "LINKED",
    });
    expect(ws?.productions[0]?.assetMatches.find((m) => m.id === "match_1")).toMatchObject({
      matchedAssetId: null,
      matchedAssetName: null,
      matchedAssetRevision: null,
      resolution: "unresolved",
      confirmed: false,
    });
    expect(ws?.productions[0]?.assetMatches.find((m) => m.id === "match_keep")).toMatchObject({
      matchedAssetId: "char_keep",
      confirmed: true,
    });

    const residual = await analyzeAssetReferenceImpact({
      projectId,
      scope: "management",
      kind: "character",
      assetId: "char_1",
      workspace: ws,
    });
    expect(residual.inUse).toBe(false);
  });

  it("workspace delete does not rewrite management assets", async () => {
    const projectId = "p_del_ws";
    await saveAssetBundleDraft({
      projectId,
      characters: [baseCharacter(projectId, { id: "char_mgmt", name: "管理角色" })],
      scenes: [],
      props: [],
      audios: [],
    });
    await saveWorkspaceLocalAssets({
      projectId,
      characters: [baseCharacter(projectId, { id: "char_ws", name: "工作台角色" })],
      scenes: [],
      props: [],
      audios: [],
    });

    const result = await deleteLibraryAsset({
      projectId,
      scope: "workspace",
      kind: "character",
      assetId: "char_ws",
      unlinkStoryboardRefs: false,
    });
    expect(result.ok).toBe(true);

    const management = await loadAssetBundleDraft(projectId);
    expect(management?.characters.map((c) => c.id)).toEqual(["char_mgmt"]);

    const { loadWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    const workspace = await loadWorkspaceLocalAssets(projectId);
    expect(workspace?.characters ?? []).toHaveLength(0);
  });

  it("pure unlink helper clears scene/prop refs without dropping siblings", () => {
    const projectId = "p_unlink_pure";
    const ws = workspaceWithRefs(projectId);
    const { workspace, changed } = unlinkAssetFromStoryboardWorkspace(
      ws,
      "prop",
      "prop_1",
    );
    expect(changed).toBe(true);
    const shot = workspace.productions[0]?.activeStoryboard?.scenes[0]?.shots[0];
    expect(shot?.propAssetIds).toEqual(["prop_keep"]);
    expect(shot?.assetMediaIds?.prop_1).toBeUndefined();
    expect(shot?.assetMediaIds?.char_keep).toBe("media_keep");
    expect(
      workspace.productions[0]?.activeStoryboard?.scenes[0]?.propAssetIds,
    ).toEqual(["prop_keep"]);
  });
});
