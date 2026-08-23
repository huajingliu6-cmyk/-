import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import type { CharacterAsset } from "@/projects/assets/types";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";

const deleteProjectAssetImageFile = vi.fn();

vi.mock("@/projects/assets/asset-image-storage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/projects/assets/asset-image-storage")>();
  return {
    ...actual,
    deleteProjectAssetImageFile: (...args: unknown[]) =>
      deleteProjectAssetImageFile(...args),
  };
});

vi.mock("@/projects/assets/asset-draft-downstream", () => ({
  synchronizeAssetDraftDownstream: vi.fn(async () => ({ deferred: false })),
}));

vi.mock("@/projects/storyboard/production-store", () => ({
  loadWorkspace: vi.fn(async () => ({ projectId: "p1", productions: [] })),
  saveWorkspace: vi.fn(),
}));

function baseChar(partial: Partial<CharacterAsset> = {}): CharacterAsset {
  return {
    id: "char_1",
    projectId: "p1",
    name: "角色",
    role: "",
    description: "",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: null,
    voiceName: null,
    voiceStyle: null,
    imageFileName: "gen_primary",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "draft",
    primaryMediaId: "gen_primary",
    lookMediaIds: [],
    historyMediaIds: [],
    approvedMediaIds: ["gen_primary"],
    mediaVideoRefSafety: {
      gen_primary: {
        status: "ok",
        checkedAt: "2026-01-01T00:00:00.000Z",
        modelId: SD2_CERT_MODEL_TAG,
      },
    },
    ...partial,
  };
}

describe("P2 character look management", () => {
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
      tmp = mkdtempSync(path.join(base, "ic-p2-"));
    } catch {
      tmp = mkdtempSync(path.join(os.tmpdir(), "ic-p2-"));
    }
    process.env.APP_DATA_DIR = tmp;
    deleteProjectAssetImageFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps primary first and sorts other looks by manual lastUsedAt", async () => {
    const {
      listSortedCharacterLookMediaIds,
      touchCharacterMediaLastUsed,
      addCharacterLook,
    } = await import("@/projects/assets/character-media-state");

    let asset = baseChar({
      mediaVideoRefSafety: {
        gen_primary: {
          status: "ok",
          checkedAt: "2026-01-01T00:00:00.000Z",
          modelId: SD2_CERT_MODEL_TAG,
        },
        gen_old: {
          status: "ok",
          checkedAt: "2026-01-01T00:00:00.000Z",
          modelId: SD2_CERT_MODEL_TAG,
        },
        gen_new: {
          status: "ok",
          checkedAt: "2026-01-01T00:00:00.000Z",
          modelId: SD2_CERT_MODEL_TAG,
        },
      },
    });
    asset = addCharacterLook(asset, "gen_old");
    asset = addCharacterLook(asset, "gen_new");
    asset = touchCharacterMediaLastUsed(
      asset,
      "gen_old",
      "2026-01-01T00:00:00.000Z",
    );
    asset = touchCharacterMediaLastUsed(
      asset,
      "gen_new",
      "2026-02-01T00:00:00.000Z",
    );
    expect(listSortedCharacterLookMediaIds(asset)).toEqual([
      "gen_new",
      "gen_old",
    ]);
  });

  it("shot route records lastUsed; preview paths do not call it", () => {
    const shotRoute = readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/projects/[projectId]/storyboard-workspace/episodes/[episodeId]/storyboard/shots/[shotId]/route.ts",
      ),
      "utf-8",
    );
    expect(shotRoute).toContain("recordManualShotMediaUsage");
    const detail = readFileSync(
      path.join(process.cwd(), "src/projects/assets/CharacterDetail.tsx"),
      "utf-8",
    );
    expect(detail).not.toContain("touchCharacterMediaLastUsed");
    expect(detail).not.toContain("recordManualShotMediaUsage");
  });

  it("delete-look returns CHARACTER_LOOK_IN_USE and leaves data unchanged", async () => {
    const { loadWorkspace } = await import(
      "@/projects/storyboard/production-store"
    );
    vi.mocked(loadWorkspace).mockResolvedValue({
      projectId: "p1",
      productions: [
        {
          id: "prod_1",
          projectId: "p1",
          episodeId: "ep1",
          episodeNumber: 1,
          activeStoryboard: {
            scenes: [
              {
                id: "sc1",
                sceneNumber: 2,
                title: "客厅",
                shots: [
                  {
                    id: "sh1",
                    shotNumber: 3,
                    assetMediaIds: { char_1: "gen_look" },
                    characterAssetIds: ["char_1"],
                    propAssetIds: [],
                    sceneAssetIds: [],
                  },
                ],
              },
            ],
          },
        },
      ],
    } as never);

    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    await saveAssetBundleDraft({
      projectId: "p1",
      characters: [
        baseChar({
          lookMediaIds: ["gen_look"],
          approvedMediaIds: ["gen_primary", "gen_look"],
          mediaVideoRefSafety: {
            gen_primary: {
              status: "ok",
              checkedAt: "2026-01-01T00:00:00.000Z",
              modelId: SD2_CERT_MODEL_TAG,
            },
            gen_look: {
              status: "ok",
              checkedAt: "2026-01-01T00:00:00.000Z",
              modelId: SD2_CERT_MODEL_TAG,
            },
          },
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    const { runCharacterLookAction } = await import(
      "@/projects/assets/character-look-actions"
    );
    const res = await runCharacterLookAction({
      projectId: "p1",
      characterId: "char_1",
      action: "delete-look",
      mediaId: "gen_look",
      store: "management",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("CHARACTER_LOOK_IN_USE");
    expect(deleteProjectAssetImageFile).not.toHaveBeenCalled();
    const after = await loadAssetBundleDraft("p1");
    expect(after?.characters[0]?.lookMediaIds).toEqual(["gen_look"]);
  });

  it("deletes unused gen_* blob only when look provenance exists; upload_* kept", async () => {
    const { loadWorkspace } = await import(
      "@/projects/storyboard/production-store"
    );
    vi.mocked(loadWorkspace).mockResolvedValue({
      projectId: "p1",
      productions: [],
    } as never);

    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { runCharacterLookAction } = await import(
      "@/projects/assets/character-look-actions"
    );

    await saveAssetBundleDraft({
      projectId: "p1",
      characters: [
        baseChar({
          lookMediaIds: ["gen_look", "upload_look", "gen_legacy"],
          approvedMediaIds: [
            "gen_primary",
            "gen_look",
            "upload_look",
            "gen_legacy",
          ],
          mediaDisplayNames: { gen_look: "外套" },
          mediaLookProvenance: {
            gen_look: {
              kind: "library_look_generation",
              jobId: "img_look",
              scope: "management",
              recordedAt: "2026-01-01T00:00:00.000Z",
            },
          },
          mediaVideoRefSafety: {
            gen_primary: {
              status: "ok",
              checkedAt: "2026-01-01T00:00:00.000Z",
              modelId: SD2_CERT_MODEL_TAG,
            },
            gen_look: {
              status: "ok",
              checkedAt: "2026-01-01T00:00:00.000Z",
              modelId: SD2_CERT_MODEL_TAG,
            },
            upload_look: {
              status: "ok",
              checkedAt: "2026-01-01T00:00:00.000Z",
              modelId: SD2_CERT_MODEL_TAG,
            },
            gen_legacy: {
              status: "ok",
              checkedAt: "2026-01-01T00:00:00.000Z",
              modelId: SD2_CERT_MODEL_TAG,
            },
          },
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    const delGen = await runCharacterLookAction({
      projectId: "p1",
      characterId: "char_1",
      action: "delete-look",
      mediaId: "gen_look",
      store: "management",
    });
    expect(delGen.status).toBe(200);
    expect((await delGen.json()).blobDeletion).toBe("deleted");
    expect(deleteProjectAssetImageFile).toHaveBeenCalledWith("p1", "gen_look");

    deleteProjectAssetImageFile.mockClear();
    const delLegacy = await runCharacterLookAction({
      projectId: "p1",
      characterId: "char_1",
      action: "delete-look",
      mediaId: "gen_legacy",
      store: "management",
    });
    expect(delLegacy.status).toBe(200);
    expect((await delLegacy.json()).blobDeletion).toBe(
      "skipped_unknown_provenance",
    );
    expect(deleteProjectAssetImageFile).not.toHaveBeenCalled();

    deleteProjectAssetImageFile.mockClear();
    const delUpload = await runCharacterLookAction({
      projectId: "p1",
      characterId: "char_1",
      action: "delete-look",
      mediaId: "upload_look",
      store: "management",
    });
    expect(delUpload.status).toBe(200);
    expect(deleteProjectAssetImageFile).not.toHaveBeenCalled();

    const after = await loadAssetBundleDraft("p1");
    expect(after?.characters[0]?.lookMediaIds ?? []).toEqual([]);
    expect(after?.characters[0]?.mediaDisplayNames?.gen_look).toBeUndefined();
  });

  it("deleting primary clears primary fields and keeps looks/status/voices", async () => {
    const { loadWorkspace } = await import(
      "@/projects/storyboard/production-store"
    );
    vi.mocked(loadWorkspace).mockResolvedValue({
      projectId: "p1",
      productions: [],
    } as never);
    const { saveWorkspaceLocalAssets, loadWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    const { runCharacterLookAction } = await import(
      "@/projects/assets/character-look-actions"
    );

    await saveWorkspaceLocalAssets({
      projectId: "p1",
      characters: [
        baseChar({
          status: "completed",
          voiceId: "v1",
          voiceName: "音色",
          lookMediaIds: ["gen_look"],
          approvedMediaIds: ["gen_primary", "gen_look"],
          mediaVoices: {
            gen_primary: { voiceId: "v1", voiceName: "音色" },
            gen_look: { voiceId: "v2", voiceName: "另一音色" },
          },
          mediaVideoRefSafety: {
            gen_primary: {
              status: "ok",
              checkedAt: "2026-01-01T00:00:00.000Z",
              modelId: SD2_CERT_MODEL_TAG,
            },
            gen_look: {
              status: "ok",
              checkedAt: "2026-01-01T00:00:00.000Z",
              modelId: SD2_CERT_MODEL_TAG,
            },
          },
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    const res = await runCharacterLookAction({
      projectId: "p1",
      characterId: "char_1",
      action: "delete-look",
      mediaId: "gen_primary",
      store: "workspace",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.missingPrimary).toBe(true);
    expect(body.character.primaryMediaId).toBeNull();
    expect(body.character.imageFileName).toBeNull();
    expect(body.character.status).toBe("completed");
    expect(body.character.lookMediaIds).toEqual(["gen_look"]);
    expect(body.character.mediaVoices.gen_look.voiceId).toBe("v2");

    const after = await loadWorkspaceLocalAssets("p1");
    expect(after?.characters[0]?.primaryMediaId).toBeNull();
  });

  it("rename-look persists optional mediaDisplayNames", async () => {
    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { runCharacterLookAction } = await import(
      "@/projects/assets/character-look-actions"
    );
    const { getCharacterMediaDisplayName } = await import(
      "@/projects/assets/character-media-state"
    );

    await saveAssetBundleDraft({
      projectId: "p1",
      characters: [
        baseChar({
          lookMediaIds: ["gen_look"],
          approvedMediaIds: ["gen_primary", "gen_look"],
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    const renamed = await runCharacterLookAction({
      projectId: "p1",
      characterId: "char_1",
      action: "rename-look",
      mediaId: "gen_look",
      displayName: "雨夜大衣",
      store: "management",
    });
    expect(renamed.status).toBe(200);
    const after = await loadAssetBundleDraft("p1");
    expect(after?.characters[0]?.mediaDisplayNames?.gen_look).toBe("雨夜大衣");
    expect(
      getCharacterMediaDisplayName(after!.characters[0]!, "gen_primary"),
    ).toContain("生成造型");
  });

  it("uncertified media cannot set-primary; add-look is allowed", async () => {
    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { runCharacterLookAction } = await import(
      "@/projects/assets/character-look-actions"
    );
    const projectId = "p1-uncert-add-look";
    await saveAssetBundleDraft({
      projectId,
      characters: [
        baseChar({
          historyMediaIds: ["gen_hist"],
          approvedMediaIds: ["gen_primary", "gen_hist"],
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    const setPrimary = await runCharacterLookAction({
      projectId,
      characterId: "char_1",
      action: "set-primary",
      mediaId: "gen_hist",
      store: "management",
    });
    expect(setPrimary.status).toBe(422);

    const addLook = await runCharacterLookAction({
      projectId,
      characterId: "char_1",
      action: "add-look",
      mediaId: "gen_hist",
      store: "management",
    });
    expect(addLook.status).toBe(200);
    const body = (await addLook.json()) as { appearance?: { id?: string } };
    expect(body.appearance?.id).toBeTruthy();
    const saved = await loadAssetBundleDraft(projectId);
    expect(saved?.characters[0]?.lookMediaIds ?? []).toContain("gen_hist");
  });

  it("merge UI requires explicit target selection", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/projects/assets/CharacterManager.tsx"),
      "utf-8",
    );
    expect(src).toContain("character-merge-targets");
    expect(src).toContain("setMergeTargetId(null)");
    expect(src).toContain("disabled={!mergeTargetId}");
  });

  it("workspace delete does not mutate management bundle", async () => {
    const { loadWorkspace } = await import(
      "@/projects/storyboard/production-store"
    );
    vi.mocked(loadWorkspace).mockResolvedValue({
      projectId: "p1",
      productions: [],
    } as never);
    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { saveWorkspaceLocalAssets, loadWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    const { runCharacterLookAction } = await import(
      "@/projects/assets/character-look-actions"
    );

    await saveAssetBundleDraft({
      projectId: "p1",
      characters: [
        baseChar({
          lookMediaIds: ["gen_mgmt"],
          approvedMediaIds: ["gen_primary", "gen_mgmt"],
          mediaVideoRefSafety: {
            gen_primary: {
              status: "ok",
              checkedAt: "2026-01-01T00:00:00.000Z",
              modelId: SD2_CERT_MODEL_TAG,
            },
            gen_mgmt: {
              status: "ok",
              checkedAt: "2026-01-01T00:00:00.000Z",
              modelId: SD2_CERT_MODEL_TAG,
            },
          },
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });
    await saveWorkspaceLocalAssets({
      projectId: "p1",
      characters: [
        baseChar({
          lookMediaIds: ["gen_ws"],
          approvedMediaIds: ["gen_primary", "gen_ws"],
          mediaVideoRefSafety: {
            gen_primary: {
              status: "ok",
              checkedAt: "2026-01-01T00:00:00.000Z",
              modelId: SD2_CERT_MODEL_TAG,
            },
            gen_ws: {
              status: "ok",
              checkedAt: "2026-01-01T00:00:00.000Z",
              modelId: SD2_CERT_MODEL_TAG,
            },
          },
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    await runCharacterLookAction({
      projectId: "p1",
      characterId: "char_1",
      action: "delete-look",
      mediaId: "gen_ws",
      store: "workspace",
    });

    expect((await loadAssetBundleDraft("p1"))?.characters[0]?.lookMediaIds).toEqual([
      "gen_mgmt",
    ]);
    expect(
      (await loadWorkspaceLocalAssets("p1"))?.characters[0]?.lookMediaIds ?? [],
    ).toEqual([]);
  });
});
