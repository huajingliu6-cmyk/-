import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import os from "os";
import path from "path";
import type { CharacterAsset } from "@/projects/assets/types";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";

const deleteProjectAssetImageFile = vi.fn();
const listImageGenerationJobs = vi.fn(async () => [] as unknown[]);
const readImageGenerationJob = vi.fn(async () => null as unknown);
const markImageJobSaved = vi.fn(async () => ({ id: "img_1" }));

vi.mock("@/projects/assets/asset-image-storage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/projects/assets/asset-image-storage")>();
  return {
    ...actual,
    deleteProjectAssetImageFile,
  };
});

vi.mock("@/projects/assets/image-generation/store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/projects/assets/image-generation/store")>();
  return {
    ...actual,
    listImageGenerationJobs,
    readImageGenerationJob,
  };
});

vi.mock("@/projects/assets/image-generation/process-job", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/projects/assets/image-generation/process-job")>();
  return {
    ...actual,
    markImageJobSaved,
  };
});

vi.mock("@/projects/assets/asset-draft-downstream", () => ({
  synchronizeAssetDraftDownstream: vi.fn(async () => ({ deferred: false })),
}));

vi.mock("@/projects/storyboard/production-store", () => ({
  loadWorkspace: vi.fn(async () => ({ projectId: "p22", productions: [] })),
  saveWorkspace: vi.fn(),
}));

function cert(mediaId: string) {
  return {
    [mediaId]: {
      status: "ok" as const,
      checkedAt: "2026-01-01T00:00:00.000Z",
      modelId: SD2_CERT_MODEL_TAG,
    },
  };
}

function baseChar(partial: Partial<CharacterAsset> = {}): CharacterAsset {
  return {
    id: "char_1",
    projectId: "p22",
    name: "角色A",
    role: "主角",
    description: "描述",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: "v1",
    voiceName: "V",
    voiceStyle: null,
    imageFileName: "gen_primary",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "completed",
    primaryMediaId: "gen_primary",
    lookMediaIds: [],
    historyMediaIds: [],
    approvedMediaIds: ["gen_primary"],
    mediaVideoRefSafety: { ...cert("gen_primary") },
    ...partial,
  };
}

describe("P2.2 character look risk closure", () => {
  let tmp: string;
  const previousAppDataDir = process.env.APP_DATA_DIR;

  beforeEach(() => {
    vi.clearAllMocks();
    const base =
      process.env.IC_TEST_TMP_ROOT ||
      (process.platform === "win32"
        ? "E:\\DevWorkspace\\runtime\\test-tmp"
        : os.tmpdir());
    try {
      tmp = mkdtempSync(path.join(base, "ic-p22-"));
    } catch {
      tmp = mkdtempSync(path.join(os.tmpdir(), "ic-p22-"));
    }
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    deleteProjectAssetImageFile.mockResolvedValue(undefined);
    listImageGenerationJobs.mockResolvedValue([]);
    readImageGenerationJob.mockResolvedValue(null);
    markImageJobSaved.mockResolvedValue({ id: "img_1" });
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("sparse-materializes only the edited character; other effective assets remain readable", async () => {
    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { loadWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    const { getEffectiveWorkspaceAssetBundle } = await import(
      "@/projects/workspace-sync/workspace-episode-design-api"
    );
    const { ensureWorkspaceInitialized } = await import(
      "@/projects/workspace-sync/ensure-workspace-initialized"
    );
    const { runCharacterLookAction } = await import(
      "@/projects/assets/character-look-actions"
    );

    await saveAssetBundleDraft({
      projectId: "p22",
      characters: [
        baseChar(),
        baseChar({
          id: "char_2",
          name: "角色B",
          primaryMediaId: "gen_b",
          imageFileName: "gen_b",
          approvedMediaIds: ["gen_b"],
          mediaVideoRefSafety: { ...cert("gen_b") },
        }),
      ],
      scenes: [
        {
          id: "scene_1",
          projectId: "p22",
          name: "场景",
          sceneType: "",
          description: "",
          timeOfDay: "",
          location: "",
          style: "",
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
          status: "draft",
        },
      ],
      props: [],
      audios: [],
    });
    await ensureWorkspaceInitialized("p22");
    expect(await loadWorkspaceLocalAssets("p22")).toBeNull();

    const renamed = await runCharacterLookAction({
      projectId: "p22",
      characterId: "char_1",
      action: "rename-look",
      mediaId: "gen_primary",
      displayName: "主造型",
      store: "workspace",
    });
    expect(renamed.status).toBe(200);

    const local = await loadWorkspaceLocalAssets("p22");
    expect(local?.characters.map((c) => c.id)).toEqual(["char_1"]);
    expect(local?.scenes ?? []).toEqual([]);
    expect(local?.characters[0]?.mediaDisplayNames?.gen_primary).toBe("主造型");

    const effective = await getEffectiveWorkspaceAssetBundle("p22");
    expect(effective.characters.map((c) => c.id).sort()).toEqual([
      "char_1",
      "char_2",
    ]);
    expect(effective.scenes.map((s) => s.id)).toEqual(["scene_1"]);
    expect(
      (await loadAssetBundleDraft("p22"))?.characters[0]?.mediaDisplayNames
        ?.gen_primary,
    ).toBeUndefined();
  });

  it("prompt substring does not block delete; structured assetMediaIds does", async () => {
    const { loadWorkspace } = await import(
      "@/projects/storyboard/production-store"
    );
    const { analyzeCharacterLookReferenceImpact } = await import(
      "@/projects/assets/character-look-reference-impact"
    );

    const shot = (id: string, extra: Record<string, unknown>) => ({
      id,
      shotNumber: 1,
      durationSeconds: 3,
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
      characterAssetIds: ["char_1"],
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
      ...extra,
    });

    const workspace = {
      projectId: "p22",
      productions: [
        {
          episodeId: "ep1",
          episodeNumber: 1,
          activeStoryboard: {
            id: "sb1",
            status: "draft",
            scenes: [
              {
                id: "sc1",
                sceneNumber: 1,
                title: "t",
                location: "",
                timeOfDay: "",
                interiorExterior: "INT",
                summary: "",
                characterAssetIds: [],
                sceneAssetIds: [],
                propAssetIds: [],
                order: 0,
                confirmed: false,
                shots: [
                  shot("sh_prompt", {
                    promptDraft: "背景里提到 gen_look_extra 字样",
                    videoPrompt: "also gen_look_extra here",
                  }),
                  shot("sh_struct", {
                    assetMediaIds: { char_1: "gen_look" },
                  }),
                  shot("sh_other", {
                    requirements: [
                      {
                        requirementId: "r1",
                        type: "character",
                        sourceName: "x",
                        normalizedName: "x",
                        selectedAssetId: "char_other",
                        resolution: "LINKED",
                        manuallyAdded: false,
                        createdAt: "",
                        updatedAt: "",
                      },
                    ],
                    sceneCharacterPlacements: [
                      { characterAssetId: "char_other", x: 0.2, y: 0.3 },
                    ],
                  }),
                ],
              },
            ],
          },
        },
      ],
    } as never;

    vi.mocked(loadWorkspace).mockResolvedValue(workspace);

    const promptOnly = analyzeCharacterLookReferenceImpact({
      characterId: "char_1",
      mediaId: "gen_look_extra",
      workspace,
    });
    expect(promptOnly.inUse).toBe(false);
    expect(promptOnly.promptMentioned).toBe(true);

    const structured = analyzeCharacterLookReferenceImpact({
      characterId: "char_1",
      mediaId: "gen_look",
      workspace,
    });
    expect(structured.inUse).toBe(true);
    expect(structured.samples[0]?.fields).toContain("assetMediaIds");

    const otherOnly = analyzeCharacterLookReferenceImpact({
      characterId: "char_1",
      mediaId: "gen_unused",
      workspace,
    });
    expect(otherOnly.inUse).toBe(false);
  });

  it("add-look with jobId stamps provenance before markSaved; markSaved failure keeps character", async () => {
    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { writeProjectAssetImageFile } = await import(
      "@/projects/assets/asset-image-storage"
    );
    const { runCharacterLookAction } = await import(
      "@/projects/assets/character-look-actions"
    );

    const PNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await writeProjectAssetImageFile({
      projectId: "p22",
      assetId: "gen_newlook",
      buffer: PNG,
      mimeType: "image/png",
    });
    await saveAssetBundleDraft({
      projectId: "p22",
      characters: [
        baseChar({
          approvedMediaIds: ["gen_primary", "gen_newlook"],
          mediaVideoRefSafety: {
            ...cert("gen_primary"),
            ...cert("gen_newlook"),
          },
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    readImageGenerationJob.mockResolvedValue({
      id: "img_look_1",
      projectId: "p22",
      scope: "management",
      subjectId: "char_1",
      subjectKind: "library_character",
      sourceEntry: "library_look",
      mediaIds: ["gen_newlook"],
      primaryMediaId: "gen_newlook",
    });
    markImageJobSaved.mockRejectedValueOnce(new Error("mark failed"));

    const res = await runCharacterLookAction({
      projectId: "p22",
      characterId: "char_1",
      action: "add-look",
      mediaId: "gen_newlook",
      jobId: "img_look_1",
      store: "management",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobMarkSavedFailed).toBe(true);
    expect(
      body.character.mediaLookProvenance.gen_newlook.kind,
    ).toBe("library_look_generation");
    expect(
      (await loadAssetBundleDraft("p22"))?.characters[0]?.mediaLookProvenance
        ?.gen_newlook?.jobId,
    ).toBe("img_look_1");
    expect(markImageJobSaved).toHaveBeenCalledWith("img_look_1");
  });

  it("invalid jobId blocks add-look without writing character look", async () => {
    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { writeProjectAssetImageFile } = await import(
      "@/projects/assets/asset-image-storage"
    );
    const { runCharacterLookAction } = await import(
      "@/projects/assets/character-look-actions"
    );
    const PNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await writeProjectAssetImageFile({
      projectId: "p22",
      assetId: "gen_bad",
      buffer: PNG,
      mimeType: "image/png",
    });
    // Keep gen_bad off approved/look lists: empty look/history arrays are
    // omitted on disk, and normalize would otherwise promote approved extras
    // into lookMediaIds — which would fake a successful write.
    await saveAssetBundleDraft({
      projectId: "p22",
      characters: [
        baseChar({
          mediaVideoRefSafety: {
            ...cert("gen_primary"),
            ...cert("gen_bad"),
          },
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });
    readImageGenerationJob.mockResolvedValue(null);

    const before = await loadAssetBundleDraft("p22");
    expect(before?.characters[0]?.lookMediaIds ?? []).toEqual([]);
    expect(before?.characters[0]?.approvedMediaIds ?? []).toEqual([
      "gen_primary",
    ]);

    const res = await runCharacterLookAction({
      projectId: "p22",
      characterId: "char_1",
      action: "add-look",
      mediaId: "gen_bad",
      jobId: "img_missing",
      store: "management",
    });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("LOOK_PROVENANCE_REQUIRED");
    const after = await loadAssetBundleDraft("p22");
    expect(after?.characters[0]?.lookMediaIds ?? []).toEqual([]);
    expect(after?.characters[0]?.approvedMediaIds ?? []).toEqual([
      "gen_primary",
    ]);
    expect(after?.characters[0]?.mediaLookProvenance?.gen_bad).toBeUndefined();
    expect(markImageJobSaved).not.toHaveBeenCalled();
  });

  it("unknown provenance generated media requires confirmUnknown and never auto-upgrades", async () => {
    const { writeProjectAssetImageFile } = await import(
      "@/projects/assets/asset-image-storage"
    );
    const { listGeneratedMediaCleanupItems, manuallyDeleteGeneratedMediaBlob } =
      await import("@/projects/assets/image-generation/orphan-generated-media");
    const PNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await writeProjectAssetImageFile({
      projectId: "p22",
      assetId: "gen_orphan",
      buffer: PNG,
      mimeType: "image/png",
    });

    const items = await listGeneratedMediaCleanupItems({
      projectId: "p22",
      scope: "management",
      context: "management",
    });
    const orphan = items.find((i) => i.storageKey === "gen_orphan");
    expect(orphan?.category).toBe("unknown_provenance");

    const blocked = await manuallyDeleteGeneratedMediaBlob({
      projectId: "p22",
      scope: "management",
      storageKey: "gen_orphan",
      confirmUnknown: false,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("UNKNOWN_PROVENANCE_CONFIRM_REQUIRED");
      expect(blocked.blobDeletion).toBe("skipped_unknown_provenance");
    }

    const confirmed = await manuallyDeleteGeneratedMediaBlob({
      projectId: "p22",
      scope: "management",
      storageKey: "gen_orphan",
      confirmUnknown: true,
    });
    expect(confirmed.ok).toBe(true);
    expect(deleteProjectAssetImageFile).toHaveBeenCalledWith(
      "p22",
      "gen_orphan",
    );
  });
});
