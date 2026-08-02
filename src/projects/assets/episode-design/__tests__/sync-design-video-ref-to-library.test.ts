import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import { syncDesignVideoRefSafetyToLibrary } from "@/projects/assets/episode-design/sync-design-video-ref-to-library";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";
import {
  loadWorkspaceLocalAssets,
  saveWorkspaceLocalAssets,
} from "@/projects/workspace-sync/store";

describe("syncDesignVideoRefSafetyToLibrary", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp = "";
  const projectId = "p_sync_vr_test";
  const mediaId = "gen_char_sync_001";
  const assetId = "asset_char_sync_001";

  function characterItem(): EpisodeAssetDesignItem {
    return {
      id: "design_item_1",
      assetType: "character",
      name: "江辰",
      draft: {
        role: "主角",
        description: "d",
        appearance: "a",
        clothing: "c",
        age: "20",
        voiceId: null,
        voiceName: null,
        voiceBound: false,
        usageInEpisode: "",
        evidence: "",
      },
      resolution: "create_new",
      existingAssetId: null,
      libraryAssetId: assetId,
      generatedMedia: {
        currentId: mediaId,
        historyIds: [mediaId],
        status: "completed",
        promptFingerprint: null,
        errorMessage: null,
        previewKind: "image",
      },
    } as EpisodeAssetDesignItem;
  }

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sync-vr-"));
    process.env.APP_DATA_DIR = tmp;
    await saveAssetBundleDraft({
      projectId,
      characters: [
        {
          id: assetId,
          projectId,
          name: "江辰",
          role: "主角",
          description: "",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: mediaId,
          imageObjectUrl: null,
          imageMimeType: "image/png",
          status: "completed",
          primaryMediaId: mediaId,
          approvedMediaIds: [mediaId],
          videoRefSafety: {
            status: "likely_real_person",
            checkedAt: "2026-07-01T00:00:00.000Z",
            reason: "旧预检",
            modelId: "ark-vlm",
          },
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    });
    await saveWorkspaceLocalAssets({
      projectId,
      characters: [
        {
          id: assetId,
          projectId,
          name: "江辰",
          role: "主角",
          description: "",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: mediaId,
          imageObjectUrl: null,
          imageMimeType: "image/png",
          status: "completed",
          primaryMediaId: mediaId,
          approvedMediaIds: [mediaId],
          videoRefSafety: {
            status: "likely_real_person",
            checkedAt: "2026-07-01T00:00:00.000Z",
            reason: "工作台本地旧预检",
            modelId: "ark-vlm",
          },
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    });
  });

  afterEach(async () => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("overwrites likely_real_person with SD ok on management + workspace", async () => {
    const ok = {
      status: "ok" as const,
      checkedAt: "2026-08-01T08:00:00.000Z",
      modelId: SD2_CERT_MODEL_TAG,
    };
    const result = await syncDesignVideoRefSafetyToLibrary({
      projectId,
      item: characterItem(),
      mediaId,
      videoRefSafety: ok,
    });
    expect(result.synced).toBe(true);
    expect(result.assetId).toBe(assetId);

    const mgmt = await loadAssetBundleDraft(projectId);
    expect(mgmt?.characters[0]?.videoRefSafety?.status).toBe("ok");
    expect(mgmt?.characters[0]?.videoRefSafety?.modelId).toBe(
      SD2_CERT_MODEL_TAG,
    );

    const local = await loadWorkspaceLocalAssets(projectId);
    expect(local?.characters[0]?.videoRefSafety?.status).toBe("ok");
  });
});
