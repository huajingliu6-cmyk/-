import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import path from "path";
import type { CharacterAsset } from "@/projects/assets/types";

function character(
  projectId: string,
  partial: Partial<CharacterAsset> = {},
): CharacterAsset {
  return {
    id: "char_vr",
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
    imageFileName: "char_vr.png",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "completed",
    primaryMediaId: "char_vr.png",
    approvedMediaIds: ["char_vr.png"],
    historyMediaIds: [],
    lookMediaIds: [],
    ...partial,
  };
}

describe("video-ref precheck persist", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  const previousRemote = process.env.REMOTE_DATA_ONLY;
  let tmp: string;
  let projectId: string;

  beforeEach(() => {
    const root =
      process.env.IC_TEST_TMP_ROOT ||
      path.join("E:", "DevWorkspace", "runtime", "test-tmp");
    mkdirSync(root, { recursive: true });
    tmp = mkdtempSync(path.join(root, "ic-vr-op-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    process.env.REMOTE_DATA_ONLY = "false";
    projectId = `p_vr_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    if (previousRemote === undefined) delete process.env.REMOTE_DATA_ONLY;
    else process.env.REMOTE_DATA_ONLY = previousRemote;
    rmSync(tmp, { recursive: true, force: true });
  });

  async function seed(description = "") {
    const { attachAssetBundleRevision } = await import(
      "@/projects/assets/asset-bundle-revision"
    );
    const { saveAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    return saveAssetBundleDraft(
      attachAssetBundleRevision(
        {
          projectId,
          characters: [character(projectId, { description })],
          scenes: [],
          props: [],
          audios: [],
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        0,
      ),
    );
  }

  const safety = {
    status: "ok" as const,
    checkedAt: "2026-08-01T00:00:00.000Z",
    modelId: "test-precheck",
    reason: "persist",
  };

  it("interleaves a main bundle save and precheck persist without silent overwrite", async () => {
    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { persistAssetVideoRefSafety } = await import(
      "@/projects/assets/video-ref-precheck-persist"
    );
    const first = await seed("base");
    const stale = {
      ...first,
      characters: first.characters.map((item) => ({
        ...item,
        description: "main-write",
      })),
    };

    const results = await Promise.allSettled([
      saveAssetBundleDraft(stale),
      persistAssetVideoRefSafety({
        projectId,
        assetId: "char_vr",
        videoRefSafety: safety,
        store: "management",
      }),
    ]);

    const rejected = results.filter((item) => item.status === "rejected");
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    if (rejected[0]?.status === "rejected") {
      expect(rejected[0].reason).toMatchObject({
        message: expect.stringMatching(/ASSET_REVISION_CONFLICT/),
      });
    }
    const disk = await loadAssetBundleDraft(projectId);
    expect(disk).not.toBeNull();
    expect(
      disk?.characters[0]?.description === "main-write" ||
        disk?.characters[0]?.videoRefSafety?.status === "ok",
    ).toBe(true);
  });

  it("rejects a stale revision persist and does not write the old snapshot", async () => {
    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { persistAssetVideoRefSafety } = await import(
      "@/projects/assets/video-ref-precheck-persist"
    );
    const first = await seed("live");
    await saveAssetBundleDraft({
      ...first,
      characters: first.characters.map((item) => ({
        ...item,
        description: "bumped",
      })),
    });
    await expect(
      saveAssetBundleDraft({
        ...first,
        characters: first.characters.map((item) => ({
          ...item,
          videoRefSafety: safety,
        })),
      }),
    ).rejects.toMatchObject({
      message: "ASSET_REVISION_CONFLICT",
    });
    const disk = await loadAssetBundleDraft(projectId);
    expect(disk?.characters[0]?.description).toBe("bumped");
    expect(disk?.characters[0]?.videoRefSafety).toBeUndefined();
    await persistAssetVideoRefSafety({
      projectId,
      assetId: "char_vr",
      videoRefSafety: safety,
      store: "management",
    });
    expect(
      (await loadAssetBundleDraft(projectId))?.characters[0]?.videoRefSafety
        ?.status,
    ).toBe("ok");
  });

  it("writes only the requested store for management vs workspace", async () => {
    const { persistAssetVideoRefSafety } = await import(
      "@/projects/assets/video-ref-precheck-persist"
    );
    const { loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { saveWorkspaceLocalAssets, loadWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    const { attachAssetBundleRevision } = await import(
      "@/projects/assets/asset-bundle-revision"
    );
    await seed("store-bound");
    const workspaceDraft = attachAssetBundleRevision(
      {
        projectId,
        characters: [
          character(projectId, {
            description: "workspace",
            videoRefSafety: {
              status: "likely_real_person",
              checkedAt: "2026-07-01T00:00:00.000Z",
            },
          }),
        ],
        scenes: [],
        props: [],
        audios: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      0,
    );
    await saveWorkspaceLocalAssets(workspaceDraft);

    await persistAssetVideoRefSafety({
      projectId,
      assetId: "char_vr",
      videoRefSafety: safety,
      store: "management",
    });
    expect(
      (await loadAssetBundleDraft(projectId))?.characters[0]?.videoRefSafety
        ?.status,
    ).toBe("ok");
    expect(
      (await loadWorkspaceLocalAssets(projectId))?.characters[0]?.videoRefSafety
        ?.status,
    ).toBe("likely_real_person");

    await persistAssetVideoRefSafety({
      projectId,
      assetId: "char_vr",
      videoRefSafety: {
        status: "other_risk",
        checkedAt: "2026-08-02T00:00:00.000Z",
      },
      store: "workspace",
    });
    expect(
      (await loadWorkspaceLocalAssets(projectId))?.characters[0]?.videoRefSafety
        ?.status,
    ).toBe("other_risk");
    expect(
      (await loadAssetBundleDraft(projectId))?.characters[0]?.videoRefSafety
        ?.status,
    ).toBe("ok");
  });
});
