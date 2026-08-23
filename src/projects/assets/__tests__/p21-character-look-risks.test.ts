import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import type { CharacterAsset } from "@/projects/assets/types";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";

const deleteProjectAssetImageFile = vi.fn();
const listImageGenerationJobs = vi.fn(async () => [] as unknown[]);

vi.mock("@/projects/assets/image-generation/store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/projects/assets/image-generation/store")>();
  return {
    ...actual,
    listImageGenerationJobs,
  };
});

vi.mock("@/projects/assets/asset-image-storage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/projects/assets/asset-image-storage")>();
  return {
    ...actual,
    deleteProjectAssetImageFile,
  };
});

vi.mock("@/projects/assets/asset-draft-downstream", () => ({
  synchronizeAssetDraftDownstream: vi.fn(async () => ({ deferred: false })),
}));

vi.mock("@/projects/storyboard/production-store", () => ({
  loadWorkspace: vi.fn(async () => ({ projectId: "p1", productions: [] })),
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
    projectId: "p21",
    name: "角色",
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
    mediaVideoRefSafety: {
      ...cert("gen_primary"),
    },
    ...partial,
  };
}

describe("P2.1 character look risk closure", () => {
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
      tmp = mkdtempSync(path.join(base, "ic-p21-"));
    } catch {
      tmp = mkdtempSync(path.join(os.tmpdir(), "ic-p21-"));
    }
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    deleteProjectAssetImageFile.mockResolvedValue(undefined);
    listImageGenerationJobs.mockResolvedValue([]);
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("materializes effective-only workspace character on successful mutation only", async () => {
    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { loadWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    const { writeProjectAssetImageFile } = await import(
      "@/projects/assets/asset-image-storage"
    );
    const { runCharacterLookAction } = await import(
      "@/projects/assets/character-look-actions"
    );
    const { ensureWorkspaceInitialized } = await import(
      "@/projects/workspace-sync/ensure-workspace-initialized"
    );

    const PNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );

    await saveAssetBundleDraft({
      projectId: "p21",
      characters: [
        baseChar({
          lookMediaIds: [],
          historyMediaIds: ["gen_hist"],
          approvedMediaIds: ["gen_primary", "gen_hist"],
          mediaVideoRefSafety: {
            ...cert("gen_primary"),
            ...cert("gen_hist"),
          },
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });
    await writeProjectAssetImageFile({
      projectId: "p21",
      assetId: "gen_hist",
      buffer: PNG,
      mimeType: "image/png",
    });
    await ensureWorkspaceInitialized("p21");

    expect(await loadWorkspaceLocalAssets("p21")).toBeNull();

    const fail = await runCharacterLookAction({
      projectId: "p21",
      characterId: "missing",
      action: "rename-look",
      mediaId: "gen_hist",
      displayName: "x",
      store: "workspace",
    });
    expect(fail.status).toBe(404);
    expect(await loadWorkspaceLocalAssets("p21")).toBeNull();

    const renamed = await runCharacterLookAction({
      projectId: "p21",
      characterId: "char_1",
      action: "rename-look",
      mediaId: "gen_hist",
      displayName: "夜景",
      store: "workspace",
    });
    expect(renamed.status).toBe(200);

    const local = await loadWorkspaceLocalAssets("p21");
    expect(local?.characters[0]?.mediaDisplayNames?.gen_hist).toBe("夜景");
    expect(
      (await loadAssetBundleDraft("p21"))?.characters[0]?.mediaDisplayNames
        ?.gen_hist,
    ).toBeUndefined();

    const addLook = await runCharacterLookAction({
      projectId: "p21",
      characterId: "char_1",
      action: "history-to-look",
      mediaId: "gen_hist",
      store: "workspace",
    });
    expect(addLook.status).toBe(200);
    expect(
      (await loadWorkspaceLocalAssets("p21"))?.characters[0]?.lookMediaIds,
    ).toContain("gen_hist");
    expect(
      (await loadAssetBundleDraft("p21"))?.characters[0]?.lookMediaIds ?? [],
    ).toEqual([]);
  });

  it("scans draft/confirmed storyboards across productions for look in-use", async () => {
    const { loadWorkspace } = await import(
      "@/projects/storyboard/production-store"
    );
    const { analyzeCharacterLookReferenceImpact } = await import(
      "@/projects/assets/character-look-reference-impact"
    );
    const { saveAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { runCharacterLookAction } = await import(
      "@/projects/assets/character-look-actions"
    );

    const shot = (id: string, media: Record<string, string>) => ({
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
      assetMediaIds: media,
      requirements: [],
      manuallyEdited: false,
      promptLocked: false,
      locked: false,
      confirmed: false,
      revision: 1,
      order: 0,
      promptRegenJobId: null,
    });

    vi.mocked(loadWorkspace).mockResolvedValue({
      projectId: "p21",
      activeEpisodeId: "ep1",
      productions: [
        {
          episodeId: "ep1",
          episodeNumber: 1,
          activeStoryboard: {
            id: "sb_draft",
            status: "draft",
            scenes: [
              {
                id: "sc1",
                sceneNumber: 1,
                title: "开场",
                location: "",
                timeOfDay: "",
                interiorExterior: "INT",
                summary: "",
                characterAssetIds: [],
                sceneAssetIds: [],
                propAssetIds: [],
                order: 0,
                confirmed: false,
                shots: [shot("sh1", { char_1: "gen_look" })],
              },
            ],
          },
        },
        {
          episodeId: "ep2",
          episodeNumber: 2,
          activeStoryboard: {
            id: "sb_ready",
            status: "confirmed",
            scenes: [
              {
                id: "sc2",
                sceneNumber: 1,
                title: "高潮",
                location: "",
                timeOfDay: "",
                interiorExterior: "EXT",
                summary: "",
                characterAssetIds: [],
                sceneAssetIds: [],
                propAssetIds: [],
                order: 0,
                confirmed: false,
                shots: [shot("sh2", { char_1: "gen_look", prop_x: "gen_other" })],
              },
            ],
          },
        },
      ],
      updatedAt: new Date().toISOString(),
    } as never);

    const impact = analyzeCharacterLookReferenceImpact({
      characterId: "char_1",
      mediaId: "gen_look",
      workspace: await loadWorkspace("p21"),
    });
    expect(impact.inUse).toBe(true);
    expect(impact.referencedShotCount).toBe(2);
    expect(impact.samples).toHaveLength(2);
    expect(impact.samples[0]?.storyboardStatus).toBe("draft");

    // Other asset media mapping unchanged / not blocking for different media
    const other = analyzeCharacterLookReferenceImpact({
      characterId: "char_1",
      mediaId: "gen_other",
      workspace: await loadWorkspace("p21"),
    });
    expect(other.inUse).toBe(true); // shared via assetMediaIds values
    expect(other.samples[0]?.fields).toContain("assetMediaIds:shared");

    await saveAssetBundleDraft({
      projectId: "p21",
      characters: [
        baseChar({
          lookMediaIds: ["gen_look"],
          approvedMediaIds: ["gen_primary", "gen_look"],
          mediaVideoRefSafety: {
            ...cert("gen_primary"),
            ...cert("gen_look"),
          },
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    const blocked = await runCharacterLookAction({
      projectId: "p21",
      characterId: "char_1",
      action: "delete-look",
      mediaId: "gen_look",
      store: "management",
    });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).code).toBe("CHARACTER_LOOK_IN_USE");
    expect(deleteProjectAssetImageFile).not.toHaveBeenCalled();
  });

  it("allows delete when unused; provenance gates blob deletion", async () => {
    const { loadWorkspace } = await import(
      "@/projects/storyboard/production-store"
    );
    vi.mocked(loadWorkspace).mockResolvedValue({
      projectId: "p21",
      productions: [],
    } as never);

    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { bindAssetBundleRevisionForSave } = await import(
      "@/projects/assets/asset-bundle-revision"
    );
    const { runCharacterLookAction } = await import(
      "@/projects/assets/character-look-actions"
    );

    await saveAssetBundleDraft({
      projectId: "p21",
      characters: [
        baseChar({
          lookMediaIds: ["gen_unknown", "gen_look", "upload_look"],
          approvedMediaIds: [
            "gen_primary",
            "gen_unknown",
            "gen_look",
            "upload_look",
          ],
          approvalProvenance: {
            source: "workspace_approval",
            generatedMediaId: "gen_approved",
          },
          mediaLookProvenance: {
            gen_look: {
              kind: "library_look_generation",
              jobId: "img_1",
              scope: "management",
              recordedAt: "2026-01-01T00:00:00.000Z",
            },
          },
          mediaVideoRefSafety: {
            ...cert("gen_primary"),
            ...cert("gen_unknown"),
            ...cert("gen_look"),
            ...cert("upload_look"),
            ...cert("gen_approved"),
          },
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    const unknown = await runCharacterLookAction({
      projectId: "p21",
      characterId: "char_1",
      action: "delete-look",
      mediaId: "gen_unknown",
      store: "management",
    });
    expect(unknown.status).toBe(200);
    const unknownBody = await unknown.json();
    expect(unknownBody.blobDeletion).toBe("skipped_unknown_provenance");
    expect(deleteProjectAssetImageFile).not.toHaveBeenCalled();

    deleteProjectAssetImageFile.mockClear();
    const owned = await runCharacterLookAction({
      projectId: "p21",
      characterId: "char_1",
      action: "delete-look",
      mediaId: "gen_look",
      store: "management",
    });
    expect(owned.status).toBe(200);
    expect((await owned.json()).blobDeletion).toBe("deleted");
    expect(deleteProjectAssetImageFile).toHaveBeenCalledWith("p21", "gen_look");

    deleteProjectAssetImageFile.mockClear();
    const upload = await runCharacterLookAction({
      projectId: "p21",
      characterId: "char_1",
      action: "delete-look",
      mediaId: "upload_look",
      store: "management",
    });
    expect(upload.status).toBe(200);
    expect((await upload.json()).blobDeletion).toBe("skipped_not_gen");
    expect(deleteProjectAssetImageFile).not.toHaveBeenCalled();

    // approval promote gen_* as look should not delete blob
    await saveAssetBundleDraft(
      await bindAssetBundleRevisionForSave("p21", {
      projectId: "p21",
      characters: [
        baseChar({
          lookMediaIds: ["gen_approved"],
          approvedMediaIds: ["gen_primary", "gen_approved"],
          approvalProvenance: {
            source: "workspace_approval",
            generatedMediaId: "gen_approved",
          },
          mediaVideoRefSafety: {
            ...cert("gen_primary"),
            ...cert("gen_approved"),
          },
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
      }),
    );
    deleteProjectAssetImageFile.mockClear();
    const approved = await runCharacterLookAction({
      projectId: "p21",
      characterId: "char_1",
      action: "delete-look",
      mediaId: "gen_approved",
      store: "management",
    });
    expect(approved.status).toBe(200);
    expect((await approved.json()).blobDeletion).toBe(
      "skipped_formal_or_shared",
    );
    expect(deleteProjectAssetImageFile).not.toHaveBeenCalled();

    // primary clear keeps blob
    deleteProjectAssetImageFile.mockClear();
    const clearPrimary = await runCharacterLookAction({
      projectId: "p21",
      characterId: "char_1",
      action: "delete-look",
      mediaId: "gen_primary",
      store: "management",
    });
    expect(clearPrimary.status).toBe(200);
    const cleared = await clearPrimary.json();
    expect(cleared.missingPrimary).toBe(true);
    expect(cleared.blobDeletion).toBe("skipped_formal_or_shared");
    expect(deleteProjectAssetImageFile).not.toHaveBeenCalled();
    expect((await loadAssetBundleDraft("p21"))?.characters[0]?.status).toBe(
      "completed",
    );
  });

  it("unified readiness blocks confirm/link and completed-without-primary", async () => {
    const { getCharacterLibraryReadiness } = await import(
      "@/projects/assets/character-library-readiness"
    );
    const { assertLinkExistingLibraryGate } = await import(
      "@/projects/assets/episode-design/confirm-transform"
    );
    const { validateAssetBundlePutTransition } = await import(
      "@/projects/assets/validate-asset-bundle-put"
    );
    const { characterDisplayStatus } = await import(
      "@/projects/assets/status"
    );

    const noPrimary = baseChar({
      status: "completed",
      primaryMediaId: null,
      imageFileName: null,
      approvedMediaIds: ["gen_look"],
      lookMediaIds: ["gen_look"],
      mediaVideoRefSafety: { ...cert("gen_look") },
    });
    const readiness = getCharacterLibraryReadiness(noPrimary);
    expect(readiness.readyForLibrary).toBe(false);
    expect(readiness.code).toBe("CHARACTER_PRIMARY_REQUIRED");
    expect(characterDisplayStatus(noPrimary)).toContain("缺少主图");

    const uncertPrimary = baseChar({
      mediaVideoRefSafety: {
        gen_primary: {
          status: "pending",
          checkedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    expect(getCharacterLibraryReadiness(uncertPrimary).code).toBe(
      "VIDEO_REF_REQUIRED",
    );

    const gate = assertLinkExistingLibraryGate(
      {
        projectId: "p21",
        characters: [noPrimary],
        scenes: [],
        props: [],
        audios: [],
      },
      {
        id: "item_1",
        assetType: "character",
        name: "角色",
        resolution: "link_existing",
        existingAssetId: "char_1",
        draft: {} as never,
      } as never,
    );
    expect(gate?.code).toBe("CHARACTER_PRIMARY_REQUIRED");

    // Text-only edit on historical completed-without-primary remains allowed
    const putOk = await validateAssetBundlePutTransition({
      projectId: "p21",
      previous: {
        projectId: "p21",
        characters: [noPrimary],
        scenes: [],
        props: [],
        audios: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      next: {
        projectId: "p21",
        characters: [{ ...noPrimary, description: "仅改文案" }],
        scenes: [],
        props: [],
        audios: [],
      },
    });
    expect(putOk.ok).toBe(true);

    // Transitioning into completed without primary is blocked
    const draftNoPrimary = {
      ...noPrimary,
      status: "draft" as const,
    };
    const putBlocked = await validateAssetBundlePutTransition({
      projectId: "p21",
      previous: {
        projectId: "p21",
        characters: [draftNoPrimary],
        scenes: [],
        props: [],
        audios: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      next: {
        projectId: "p21",
        characters: [{ ...draftNoPrimary, status: "completed" }],
        scenes: [],
        props: [],
        audios: [],
      },
    });
    expect(putBlocked.ok).toBe(false);
    if (!putBlocked.ok) {
      expect(putBlocked.error.code).toBe("CHARACTER_PRIMARY_REQUIRED");
    }
  });
});
