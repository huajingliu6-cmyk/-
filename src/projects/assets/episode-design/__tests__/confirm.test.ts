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
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";

const sd2CertifiedSafety = {
  status: "ok" as const,
  checkedAt: "2026-08-01T00:00:00.000Z",
  modelId: SD2_CERT_MODEL_TAG,
};

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
          generatedMedia: {
            currentId: "gen_character_1",
            historyIds: ["gen_character_1"],
            history: [
              {
                mediaId: "gen_character_1",
                prompt: "角色图",
                generatedAt: "2026-08-01T00:00:00.000Z",
                mimeType: "image/webp",
                voiceId: "voice_1",
                voiceName: "测试音色",
                voiceBound: true,
                videoRefSafety: sd2CertifiedSafety,
              },
            ],
            status: "completed",
            promptFingerprint: null,
            errorMessage: null,
            mimeType: "image/webp",
            previewKind: "image",
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
      expect(result.promoted).toEqual(result.createdAssets);
      expect(result.skipped).toEqual([]);
      expect(result.createdAssets[0]?.itemId).toBe("i1");
      expect(result.record.items[0]?.libraryAssetId).toBe(
        result.createdAssets[0]?.assetId,
      );
    }

    const bundle = await loadAssetBundleDraft("p1");
    expect(bundle?.characters.some((c) => c.name === "新角色")).toBe(true);
    expect(bundle?.characters[0]?.status).toBe("completed");
    expect(bundle?.characters[0]?.imageFileName).toBe("gen_character_1");
    expect(bundle?.characters[0]?.imageMimeType).toBe("image/webp");
    expect(bundle?.characters[0]?.age).toBe("28");
    expect(bundle?.characters[0]?.voiceId).toBe("voice_1");
    expect(bundle?.characters[0]?.voiceName).toBe("测试音色");
    expect(bundle?.characters[0]?.videoRefSafety?.modelId).toBe(SD2_CERT_MODEL_TAG);
    expect(
      bundle?.characters[0]?.mediaVideoRefSafety?.["gen_character_1"]?.modelId,
    ).toBe(SD2_CERT_MODEL_TAG);
    expect(bundle?.characters[0]?.mediaVoices?.["gen_character_1"]?.voiceId).toBe(
      "voice_1",
    );
    expect(
      bundle?.characters[0]?.mediaVoices?.["gen_character_1"]?.voiceName,
    ).toBe("测试音色");
  });

  it("rejects single-item character confirm without SD2 video-ref cert", async () => {
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
          name: "未校验角色",
          resolution: "create_new",
          source: "ai",
          draft: {
            description: "描述",
            appearance: "外貌",
            clothing: "服装",
            role: "配角",
            age: "28",
            voiceId: null,
            voiceName: null,
            voiceBound: false,
            usageInEpisode: "出场",
            evidence: "",
          },
          generatedMedia: {
            currentId: "gen_character_uncert",
            historyIds: ["gen_character_uncert"],
            history: [
              {
                mediaId: "gen_character_uncert",
                prompt: "角色图",
                generatedAt: "2026-08-01T00:00:00.000Z",
                mimeType: "image/webp",
              },
            ],
            status: "completed",
            promptFingerprint: null,
            errorMessage: null,
            mimeType: "image/webp",
            previewKind: "image",
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
      itemId: "i1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VIDEO_REF_REQUIRED");
  });

  it("batch confirms mix of success and VIDEO_REF_REQUIRED skip", async () => {
    await seedRecord({
      episodeId: "ep1",
      episodeNumber: 1,
      status: "review",
      revision: 1,
      contentFingerprint: fingerprint,
      generationId: "g1",
      items: [
        {
          id: "i_ok",
          assetType: "character",
          name: "已校验角色",
          resolution: "create_new",
          source: "ai",
          draft: {
            description: "描述",
            appearance: "外貌",
            clothing: "服装",
            role: "配角",
            age: "28",
            voiceId: null,
            voiceName: null,
            voiceBound: false,
            usageInEpisode: "出场",
            evidence: "",
          },
          generatedMedia: {
            currentId: "gen_ok",
            historyIds: ["gen_ok"],
            history: [
              {
                mediaId: "gen_ok",
                prompt: "角色图",
                generatedAt: "2026-08-01T00:00:00.000Z",
                mimeType: "image/webp",
                videoRefSafety: sd2CertifiedSafety,
              },
            ],
            status: "completed",
            promptFingerprint: null,
            errorMessage: null,
            mimeType: "image/webp",
            previewKind: "image",
          },
        },
        {
          id: "i_skip",
          assetType: "character",
          name: "未校验角色",
          resolution: "create_new",
          source: "ai",
          draft: {
            description: "描述",
            appearance: "外貌",
            clothing: "服装",
            role: "配角",
            age: "20",
            voiceId: null,
            voiceName: null,
            voiceBound: false,
            usageInEpisode: "出场",
            evidence: "",
          },
          generatedMedia: {
            currentId: "gen_skip",
            historyIds: ["gen_skip"],
            history: [
              {
                mediaId: "gen_skip",
                prompt: "角色图",
                generatedAt: "2026-08-01T00:00:00.000Z",
                mimeType: "image/webp",
              },
            ],
            status: "completed",
            promptFingerprint: null,
            errorMessage: null,
            mimeType: "image/webp",
            previewKind: "image",
          },
        },
        {
          id: "i_prop",
          assetType: "prop",
          name: "雨伞",
          resolution: "create_new",
          source: "ai",
          draft: {
            description: "伞",
            propType: "道具",
            usage: "剧情",
            usageInEpisode: "",
            evidence: "",
          },
          generatedMedia: {
            currentId: "gen_prop_ok",
            historyIds: ["gen_prop_ok"],
            status: "completed",
            promptFingerprint: null,
            errorMessage: null,
            mimeType: "image/png",
            previewKind: "image",
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
    if (!result.ok) return;
    expect(result.counts.created).toBe(2);
    expect(result.promoted.map((p) => p.itemId).sort()).toEqual([
      "i_ok",
      "i_prop",
    ]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.itemId).toBe("i_skip");
    expect(result.skipped[0]?.code).toBe("VIDEO_REF_REQUIRED");
    expect(result.record.status).toBe("review");
    expect(result.record.items.find((i) => i.id === "i_skip")?.libraryAssetId).toBeFalsy();
    expect(result.record.items.find((i) => i.id === "i_ok")?.libraryAssetId).toBeTruthy();
  });

  it("retries skipped items after cert without duplicating successes", async () => {
    await seedRecord({
      episodeId: "ep1",
      episodeNumber: 1,
      status: "review",
      revision: 1,
      contentFingerprint: fingerprint,
      generationId: "g1",
      items: [
        {
          id: "i_ok",
          assetType: "prop",
          name: "雨伞",
          resolution: "create_new",
          source: "ai",
          draft: {
            description: "伞",
            propType: "道具",
            usage: "剧情",
            usageInEpisode: "",
            evidence: "",
          },
          generatedMedia: {
            currentId: "gen_prop_ok",
            historyIds: ["gen_prop_ok"],
            status: "completed",
            promptFingerprint: null,
            errorMessage: null,
            mimeType: "image/png",
            previewKind: "image",
          },
        },
        {
          id: "i_skip",
          assetType: "character",
          name: "未校验角色",
          resolution: "create_new",
          source: "ai",
          draft: {
            description: "描述",
            appearance: "外貌",
            clothing: "服装",
            role: "配角",
            age: "20",
            voiceId: null,
            voiceName: null,
            voiceBound: false,
            usageInEpisode: "出场",
            evidence: "",
          },
          generatedMedia: {
            currentId: "gen_skip",
            historyIds: ["gen_skip"],
            history: [
              {
                mediaId: "gen_skip",
                prompt: "角色图",
                generatedAt: "2026-08-01T00:00:00.000Z",
                mimeType: "image/webp",
              },
            ],
            status: "completed",
            promptFingerprint: null,
            errorMessage: null,
            mimeType: "image/webp",
            previewKind: "image",
          },
        },
      ],
      confirmedAt: null,
      confirmedBy: null,
      confirmedRevision: null,
      updatedAt: new Date().toISOString(),
    });

    const first = await confirmEpisodeAssetDesign({
      projectId: "p1",
      episodeId: "ep1",
      expectedRevision: 1,
      userId: "u1",
      fingerprint,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.record.status).toBe("review");
    expect(first.counts.created).toBe(1);
    const firstOkId = first.record.items.find((i) => i.id === "i_ok")?.libraryAssetId;
    expect(firstOkId).toBeTruthy();

    const store = await loadEpisodeAssetDesignStore("p1");
    const record = store.records.find((r) => r.episodeId === "ep1")!;
    await saveEpisodeAssetDesignStore(
      upsertEpisodeRecord(store, {
        ...record,
        items: record.items.map((item) =>
          item.id === "i_skip"
            ? {
                ...item,
                generatedMedia: {
                  ...item.generatedMedia!,
                  history: [
                    {
                      mediaId: "gen_skip",
                      prompt: "角色图",
                      generatedAt: "2026-08-01T00:00:00.000Z",
                      mimeType: "image/webp",
                      videoRefSafety: sd2CertifiedSafety,
                    },
                  ],
                  videoRefSafety: sd2CertifiedSafety,
                },
              }
            : item,
        ),
      }),
    );

    const second = await confirmEpisodeAssetDesign({
      projectId: "p1",
      episodeId: "ep1",
      expectedRevision: 1,
      userId: "u1",
      fingerprint,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.counts.created).toBe(1);
    expect(second.skipped).toEqual([]);
    expect(second.record.status).toBe("confirmed");
    expect(second.record.items.find((i) => i.id === "i_ok")?.libraryAssetId).toBe(
      firstOkId,
    );
    const bundle = await loadAssetBundleDraft("p1");
    expect(bundle?.props.filter((p) => p.name === "雨伞")).toHaveLength(1);
    expect(bundle?.characters.some((c) => c.name === "未校验角色")).toBe(true);
  });

  it("confirms one item without closing the record or duplicating it later", async () => {
    const makeProp = (id: string, name: string, mediaId: string) => ({
      id,
      assetType: "prop" as const,
      name,
      resolution: "create_new" as const,
      source: "ai" as const,
      draft: {
        description: name,
        propType: "道具",
        usage: "剧情",
        usageInEpisode: "",
        evidence: "",
      },
      generatedMedia: {
        currentId: mediaId,
        historyIds: [mediaId],
        status: "completed" as const,
        promptFingerprint: null,
        errorMessage: null,
        mimeType: "image/png",
        previewKind: "image" as const,
      },
    });
    await seedRecord({
      episodeId: "ep1",
      episodeNumber: 1,
      status: "review",
      revision: 3,
      contentFingerprint: fingerprint,
      generationId: null,
      items: [
        makeProp("i1", "雨伞", "gen_prop_1"),
        makeProp("i2", "手提箱", "gen_prop_2"),
      ],
      confirmedAt: null,
      confirmedBy: null,
      confirmedRevision: null,
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const single = await confirmEpisodeAssetDesign({
      projectId: "p1",
      episodeId: "ep1",
      expectedRevision: 3,
      userId: "u1",
      fingerprint,
      itemId: "i1",
    });
    expect(single.ok).toBe(true);
    if (!single.ok) return;
    expect(single.record.status).toBe("review");
    expect(single.record.items[0]?.libraryAssetId).toBeTruthy();
    expect(single.record.items[1]?.libraryAssetId).toBeFalsy();

    const all = await confirmEpisodeAssetDesign({
      projectId: "p1",
      episodeId: "ep1",
      expectedRevision: 3,
      userId: "u1",
      fingerprint,
    });
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.counts.created).toBe(1);
    const bundle = await loadAssetBundleDraft("p1");
    expect(bundle?.props.map((item) => item.name)).toEqual(["雨伞", "手提箱"]);
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

  it("batch confirm creates draft library rows without images when approval is disabled", async () => {
    await seedRecord({
      episodeId: "ep_no_approval",
      episodeNumber: 2,
      status: "review",
      revision: 1,
      contentFingerprint: fingerprint,
      generationId: "g2",
      items: [
        {
          id: "i_draft",
          assetType: "prop",
          name: "旧钥匙",
          resolution: "create_new",
          source: "ai",
          draft: {
            description: "一把磨损的铜钥匙",
            propType: "线索",
            usage: "开启暗门",
            usageInEpisode: "第二集",
            evidence: "",
          },
        },
        {
          id: "i_char",
          assetType: "character",
          name: "无图角色",
          resolution: "create_new",
          source: "ai",
          draft: {
            description: "描述",
            appearance: "",
            clothing: "",
            role: "配角",
            age: "",
            voiceId: null,
            voiceName: null,
            voiceBound: false,
            usageInEpisode: "",
            evidence: "",
          },
        },
        {
          id: "i_scene",
          assetType: "scene",
          name: "无图场景",
          resolution: "create_new",
          source: "ai",
          draft: {
            description: "描述",
            timeOfDay: "",
            location: "",
            style: "",
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
      episodeId: "ep_no_approval",
      expectedRevision: 1,
      userId: "u1",
      fingerprint,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.counts.created).toBe(3);
    expect(result.skipped).toEqual([]);
    expect(result.record.status).toBe("confirmed");
    const bundle = await loadAssetBundleDraft("p1");
    expect(bundle?.props.map((item) => item.name)).toEqual(["旧钥匙"]);
    expect(bundle?.characters.map((item) => item.name)).toEqual(["无图角色"]);
    expect(bundle?.scenes.map((item) => item.name)).toEqual(["无图场景"]);
    expect(bundle?.props[0]?.status).toBe("draft");
    expect(bundle?.characters[0]?.status).toBe("draft");
    expect(bundle?.scenes[0]?.status).toBe("draft");
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
