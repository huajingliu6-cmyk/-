import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import {
  patchImageableAssetImageMeta,
  patchImageableAssetVideoRefSafety,
} from "@/projects/assets/asset-image-storage";

describe("videoRefSafety cleared on image change", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-safety-"));
    process.env.APP_DATA_DIR = tmp;
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("clears safety when image meta is patched", async () => {
    const projectId = "p_safety_clear";
    await fs.mkdir(path.join(tmp, "projects", projectId, "drafts"), {
      recursive: true,
    });
    await saveAssetBundleDraft({
      projectId,
      characters: [
        {
          id: "char_1",
          projectId,
          name: "江宸",
          role: "",
          description: "",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: "old.png",
          imageObjectUrl: null,
          imageMimeType: "image/png",
          status: "completed",
          videoRefSafety: {
            status: "ok",
            checkedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    await patchImageableAssetVideoRefSafety({
      projectId,
      assetId: "char_1",
      videoRefSafety: {
        status: "likely_real_person",
        checkedAt: "2026-01-02T00:00:00.000Z",
        reason: "test",
      },
    });
    let draft = await loadAssetBundleDraft(projectId);
    expect(draft?.characters[0]?.videoRefSafety?.status).toBe(
      "likely_real_person",
    );

    await patchImageableAssetImageMeta({
      projectId,
      assetId: "char_1",
      imageFileName: "new.png",
      imageMimeType: "image/png",
    });
    draft = await loadAssetBundleDraft(projectId);
    expect(draft?.characters[0]?.videoRefSafety).toBeNull();
  });
});
