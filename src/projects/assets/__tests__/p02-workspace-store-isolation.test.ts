import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import { createLibraryCharacterWithImage } from "@/projects/assets/create-library-imageable-asset";
import { runCharacterMediaAction } from "@/projects/assets/character-media-actions";
import { serveProjectAssetImageGet } from "@/projects/assets/asset-image-route-handlers";
import { writeProjectAssetImageFile } from "@/projects/assets/asset-image-storage";
import { loadWorkspaceLocalAssets } from "@/projects/workspace-sync/store";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";
import type { CharacterAsset } from "@/projects/assets/types";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

vi.mock("@/projects/assets/asset-draft-downstream", () => ({
  synchronizeAssetDraftDownstream: vi.fn(async () => ({ deferred: false })),
  synchronizeAssetMediaDownstream: vi.fn(async () => undefined),
}));

describe("P0.2 workspace store isolation", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-p02-ws-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("workspace-created character never lands in management draft", async () => {
    const response = await createLibraryCharacterWithImage({
      projectId: "p_ws",
      store: "workspace",
      name: "工作台角色",
      bytes: PNG_BYTES,
      mimeType: "image/png",
      certify: async () => ({
        status: "ok",
        checkedAt: new Date().toISOString(),
        modelId: SD2_CERT_MODEL_TAG,
      }),
    });
    expect([200, 201]).toContain(response.status);
    const body = (await response.json()) as { character: CharacterAsset };
    expect(body.character.name).toBe("工作台角色");

    const management = await loadAssetBundleDraft("p_ws");
    expect(management?.characters ?? []).toHaveLength(0);

    const workspace = await loadWorkspaceLocalAssets("p_ws");
    expect(workspace?.characters.map((c) => c.id)).toContain(body.character.id);

    const imageGet = await serveProjectAssetImageGet({
      projectId: "p_ws",
      assetId: body.character.primaryMediaId ?? body.character.id,
      store: "workspace",
    });
    expect(imageGet.status).toBe(200);

    const managementImage = await serveProjectAssetImageGet({
      projectId: "p_ws",
      assetId: body.character.primaryMediaId ?? body.character.id,
      store: "management",
    });
    expect(managementImage.status).toBe(404);
  });

  it("workspace set-primary does not rewrite management bundle", async () => {
    const managementChar: CharacterAsset = {
      id: "char_mgmt",
      projectId: "p_ws2",
      name: "管理角色",
      role: "",
      description: "",
      appearance: "",
      clothing: "",
      age: "",
      gender: "",
      voiceId: null,
      voiceName: null,
      voiceStyle: null,
      imageFileName: "m_primary",
      imageObjectUrl: null,
      imageMimeType: "image/png",
      status: "completed",
      primaryMediaId: "m_primary",
      approvedMediaIds: ["m_primary", "m_hist"],
      historyMediaIds: ["m_hist"],
      lookMediaIds: [],
      videoRefSafety: {
        status: "ok",
        checkedAt: "2026-01-01T00:00:00.000Z",
        modelId: SD2_CERT_MODEL_TAG,
      },
      mediaVideoRefSafety: {
        m_primary: {
          status: "ok",
          checkedAt: "2026-01-01T00:00:00.000Z",
          modelId: SD2_CERT_MODEL_TAG,
        },
        m_hist: {
          status: "ok",
          checkedAt: "2026-01-02T00:00:00.000Z",
          modelId: SD2_CERT_MODEL_TAG,
        },
      },
    };
    await saveAssetBundleDraft({
      projectId: "p_ws2",
      characters: [managementChar],
      scenes: [],
      props: [],
      audios: [],
    });

    const wsChar: CharacterAsset = {
      ...managementChar,
      id: "char_ws",
      name: "工作台角色",
      primaryMediaId: "w_primary",
      imageFileName: "w_primary",
      approvedMediaIds: ["w_primary", "w_hist"],
      historyMediaIds: ["w_hist"],
      mediaVideoRefSafety: {
        w_primary: {
          status: "ok",
          checkedAt: "2026-01-01T00:00:00.000Z",
          modelId: SD2_CERT_MODEL_TAG,
        },
        w_hist: {
          status: "ok",
          checkedAt: "2026-01-02T00:00:00.000Z",
          modelId: SD2_CERT_MODEL_TAG,
        },
      },
    };
    const { saveWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    await saveWorkspaceLocalAssets({
      projectId: "p_ws2",
      characters: [wsChar],
      scenes: [],
      props: [],
      audios: [],
    });
    await writeProjectAssetImageFile({
      projectId: "p_ws2",
      assetId: "w_hist",
      buffer: PNG_BYTES,
      mimeType: "image/png",
    });
    await writeProjectAssetImageFile({
      projectId: "p_ws2",
      assetId: "w_primary",
      buffer: PNG_BYTES,
      mimeType: "image/png",
    });

    const response = await runCharacterMediaAction({
      projectId: "p_ws2",
      characterId: "char_ws",
      action: "set-primary",
      mediaId: "w_hist",
      store: "workspace",
    });
    expect(response.status).toBe(200);

    const managementAfter = await loadAssetBundleDraft("p_ws2");
    expect(managementAfter?.characters).toHaveLength(1);
    expect(managementAfter?.characters[0]?.id).toBe("char_mgmt");
    expect(managementAfter?.characters[0]?.primaryMediaId).toBe("m_primary");

    const workspaceAfter = await loadWorkspaceLocalAssets("p_ws2");
    const wsCharAfter = workspaceAfter?.characters.find((c) => c.id === "char_ws");
    expect(wsCharAfter?.primaryMediaId).toBe("w_hist");
  });
});
