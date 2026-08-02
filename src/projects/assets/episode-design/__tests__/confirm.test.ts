import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { confirmEpisodeAssetDesign } from "@/projects/assets/episode-design/confirm";
import { getScriptEpisodeContentFingerprint } from "@/projects/assets/episode-design/fingerprint";
import {
  loadEpisodeAssetDesignStore,
  saveEpisodeAssetDesignStore,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import type { EpisodeAssetDesignRecord } from "@/projects/assets/episode-design/types";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";

describe("confirmEpisodeAssetDesign", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-ead-confirm-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  const fingerprint = getScriptEpisodeContentFingerprint({
    episodeNumber: 1,
    title: "第1集",
    content: "正文",
  });

  async function seedRecord(record: EpisodeAssetDesignRecord) {
    const store = await loadEpisodeAssetDesignStore("p1");
    await saveEpisodeAssetDesignStore(upsertEpisodeRecord(store, record));
  }

  it("creates new assets and marks record confirmed", async () => {
    await seedRecord({
      episodeId: "ep1",
      episodeNumber: 1,
      status: "review",
      revision: 1,
      contentFingerprint: fingerprint,
      generationId: "g1",
      items: [
        {
          id: "i1",
          assetType: "character",
          name: "新角色",
          resolution: "create_new",
          source: "ai",
          draft: {
            description: "描述",
            appearance: "外貌",
            clothing: "服装",
            role: "配角",
            age: "28",
            voiceId: "voice_1",
            voiceName: "测试音色",
            voiceBound: true,
            usageInEpisode: "出场",
            evidence: "",
          },
        },
      ],
      confirmedAt: null,
      confirmedBy: null,
      confirmedRevision: null,
      updatedAt: new Date().toISOString(),
    });

    const result = await confirmEpisodeAssetDesign({
      projectId: "p1",
      episodeId: "ep1",
      expectedRevision: 1,
      userId: "u1",
      fingerprint,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.counts.created).toBe(1);
      expect(result.record.status).toBe("confirmed");
      expect(result.createdAssets).toHaveLength(1);
      expect(result.createdAssets[0]?.itemId).toBe("i1");
      expect(result.record.items[0]?.libraryAssetId).toBe(
        result.createdAssets[0]?.assetId,
      );
    }

    const bundle = await loadAssetBundleDraft("p1");
    expect(bundle?.characters.some((c) => c.name === "新角色")).toBe(true);
    expect(bundle?.characters[0]?.status).toBe("draft");
    expect(bundle?.characters[0]?.imageFileName).toBeNull();
    expect(bundle?.characters[0]?.age).toBe("28");
    expect(bundle?.characters[0]?.voiceId).toBe("voice_1");
    expect(bundle?.characters[0]?.voiceName).toBe("测试音色");
  });

  it("rejects pending resolutions", async () => {
    await seedRecord({
      episodeId: "ep1",
      episodeNumber: 1,
      status: "review",
      revision: 1,
      contentFingerprint: fingerprint,
      generationId: null,
      items: [
        {
          id: "i1",
          assetType: "prop",
          name: "伞",
          resolution: "pending",
          source: "ai",
          draft: {
            description: "",
            propType: "",
            usage: "",
            usageInEpisode: "",
            evidence: "",
          },
        },
      ],
      confirmedAt: null,
      confirmedBy: null,
      confirmedRevision: null,
      updatedAt: new Date().toISOString(),
    });

    const result = await confirmEpisodeAssetDesign({
      projectId: "p1",
      episodeId: "ep1",
      expectedRevision: 1,
      userId: "u1",
      fingerprint,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RESOLUTION_PENDING");
  });

  it("is idempotent when already confirmed at same revision", async () => {
    const record: EpisodeAssetDesignRecord = {
      episodeId: "ep1",
      episodeNumber: 1,
      status: "confirmed",
      revision: 2,
      contentFingerprint: fingerprint,
      generationId: null,
      items: [],
      confirmedAt: new Date().toISOString(),
      confirmedBy: "u1",
      confirmedRevision: 2,
      updatedAt: new Date().toISOString(),
    };
    await seedRecord(record);

    const result = await confirmEpisodeAssetDesign({
      projectId: "p1",
      episodeId: "ep1",
      expectedRevision: 2,
      userId: "u1",
      fingerprint,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.counts.created).toBe(0);
    }
  });
});
