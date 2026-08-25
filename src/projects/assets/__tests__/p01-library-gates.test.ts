import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { getScriptEpisodeContentFingerprint } from "@/projects/assets/episode-design/fingerprint";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import { validateAssetBundlePutTransition } from "@/projects/assets/validate-asset-bundle-put";
import { createLibraryCharacterWithImage } from "@/projects/assets/create-library-imageable-asset";
import { assertLinkExistingLibraryGate } from "@/projects/assets/episode-design/confirm-transform";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";
import type { CharacterAsset } from "@/projects/assets/types";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const sd2Ok = {
  status: "ok" as const,
  checkedAt: "2026-08-01T00:00:00.000Z",
  modelId: SD2_CERT_MODEL_TAG,
};

function baseCharacter(overrides: Partial<CharacterAsset> = {}): CharacterAsset {
  return {
    id: "char_1",
    projectId: "p1",
    name: "林清",
    role: "女主",
    description: "描述",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: null,
    voiceName: null,
    voiceStyle: null,
    imageFileName: "media_primary",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "completed",
    primaryMediaId: "media_primary",
    approvedMediaIds: ["media_primary"],
    historyMediaIds: [],
    lookMediaIds: [],
    videoRefSafety: sd2Ok,
    mediaVideoRefSafety: { media_primary: sd2Ok },
    ...overrides,
  };
}

describe("P0.1 library gates", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-p01-gates-"));
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

  it("PUT cannot forge SD2 safety on existing character", async () => {
    await saveAssetBundleDraft({
      projectId: "p1",
      characters: [baseCharacter({ videoRefSafety: null, mediaVideoRefSafety: undefined })],
      scenes: [],
      props: [],
      audios: [],
    });
    const previous = await loadAssetBundleDraft("p1");
    const forged = baseCharacter({
      videoRefSafety: sd2Ok,
      mediaVideoRefSafety: { media_primary: sd2Ok },
    });
    const result = await validateAssetBundlePutTransition({
      projectId: "p1",
      previous,
      next: {
        projectId: "p1",
        characters: [forged],
        scenes: [],
        props: [],
        audios: [],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VIDEO_REF_FORGERY");
  });

  it("PUT cannot add uncertified look or switch uncertified primary", async () => {
    await saveAssetBundleDraft({
      projectId: "p1",
      characters: [
        baseCharacter({
          historyMediaIds: ["hist_uncert"],
          approvedMediaIds: ["media_primary", "hist_uncert"],
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });
    const previous = await loadAssetBundleDraft("p1");

    const lookResult = await validateAssetBundlePutTransition({
      projectId: "p1",
      previous,
      next: {
        projectId: "p1",
        characters: [
          baseCharacter({
            historyMediaIds: ["hist_uncert"],
            lookMediaIds: ["hist_uncert"],
            approvedMediaIds: ["media_primary", "hist_uncert"],
          }),
        ],
        scenes: [],
        props: [],
        audios: [],
      },
    });
    expect(lookResult.ok).toBe(false);
    if (!lookResult.ok) expect(lookResult.error.code).toBe("UNCERTIFIED_LOOK");

    const primaryResult = await validateAssetBundlePutTransition({
      projectId: "p1",
      previous,
      next: {
        projectId: "p1",
        characters: [
          baseCharacter({
            primaryMediaId: "hist_uncert",
            imageFileName: "hist_uncert",
            historyMediaIds: ["media_primary"],
            approvedMediaIds: ["media_primary", "hist_uncert"],
          }),
        ],
        scenes: [],
        props: [],
        audios: [],
      },
    });
    expect(primaryResult.ok).toBe(false);
    if (!primaryResult.ok) expect(primaryResult.error.code).toBe("UNCERTIFIED_PRIMARY");
  });

  it("PUT rejects brand-new characters", async () => {
    await saveAssetBundleDraft({
      projectId: "p1",
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    });
    const previous = await loadAssetBundleDraft("p1");
    const result = await validateAssetBundlePutTransition({
      projectId: "p1",
      previous,
      next: {
        projectId: "p1",
        characters: [
          baseCharacter({
            id: "char_new",
            videoRefSafety: null,
            mediaVideoRefSafety: undefined,
          }),
        ],
        scenes: [],
        props: [],
        audios: [],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CHARACTER_CREATE_FORBIDDEN");
  });

  it("link_existing rejects non-compliant targets", () => {
    const bundle = {
      projectId: "p1",
      characters: [
        baseCharacter({
          id: "uncert_char",
          videoRefSafety: { status: "ok", checkedAt: "t", modelId: "other" },
          mediaVideoRefSafety: {
            media_primary: { status: "ok", checkedAt: "t", modelId: "other" },
          },
        }),
      ],
      scenes: [
        {
          id: "scene_blank",
          projectId: "p1",
          name: "空场景",
          sceneType: "",
          description: "",
          timeOfDay: "",
          location: "",
          style: "",
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
          status: "draft" as const,
        },
      ],
      props: [],
      audios: [],
    };

    const charItem = {
      id: "i1",
      assetType: "character",
      name: "角色",
      resolution: "link_existing",
      existingAssetId: "uncert_char",
    } as EpisodeAssetDesignItem;
    expect(assertLinkExistingLibraryGate(bundle, charItem)?.code).toBe(
      "VIDEO_REF_REQUIRED",
    );

    const sceneItem = {
      id: "i2",
      assetType: "scene",
      name: "场景",
      resolution: "link_existing",
      existingAssetId: "scene_blank",
    } as EpisodeAssetDesignItem;
    expect(assertLinkExistingLibraryGate(bundle, sceneItem)?.code).toBe(
      "IMAGE_REQUIRED",
    );

    const mismatch = {
      id: "i3",
      assetType: "prop",
      name: "道具",
      resolution: "link_existing",
      existingAssetId: "uncert_char",
    } as EpisodeAssetDesignItem;
    expect(assertLinkExistingLibraryGate(bundle, mismatch)?.code).toBe(
      "ASSET_TYPE_MISMATCH",
    );
  });

  it("character create failure never leaves a character row", async () => {
    const before = await loadAssetBundleDraft("p1");
    expect(before?.characters ?? []).toHaveLength(0);

    const response = await createLibraryCharacterWithImage({
      projectId: "p1",
      store: "management",
      name: "失败角色",
      bytes: PNG_BYTES,
      mimeType: "image/png",
      certify: async () => ({
        status: "likely_real_person",
        checkedAt: new Date().toISOString(),
        modelId: SD2_CERT_MODEL_TAG,
        reason: "reject",
      }),
    });
    expect(response.status).toBe(422);

    const duringReads = await Promise.all([
      loadAssetBundleDraft("p1"),
      loadAssetBundleDraft("p1"),
      loadAssetBundleDraft("p1"),
    ]);
    for (const draft of duringReads) {
      expect(draft?.characters ?? []).toHaveLength(0);
    }
  });

  it("workspace confirm path uses the same transform gates for imageless items", async () => {
    const { transformEpisodeAssetDesignConfirmation } = await import(
      "@/projects/assets/episode-design/confirm-transform"
    );
    const { readFileSync } = await import("fs");
    const workspaceConfirmSource = readFileSync(
      path.join(
        process.cwd(),
        "src/projects/workspace-sync/workspace-confirm.ts",
      ),
      "utf8",
    );
    expect(workspaceConfirmSource).toContain(
      "transformEpisodeAssetDesignConfirmation",
    );
    expect(workspaceConfirmSource).not.toContain("requireGeneratedMedia");

    const result = transformEpisodeAssetDesignConfirmation({
      projectId: "p1",
      episodeId: "ep1",
      expectedRevision: 1,
      userId: "u1",
      fingerprint,
      store: {
        projectId: "p1",
        updatedAt: new Date().toISOString(),
        records: [
          {
            episodeId: "ep1",
            episodeNumber: 1,
            status: "review",
            revision: 1,
            contentFingerprint: fingerprint,
            generationId: null,
            items: [
              {
                id: "i_prop",
                assetType: "prop",
                name: "无图道具",
                resolution: "create_new",
                source: "ai",
                draft: {
                  description: "x",
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
          },
        ],
      },
      bundle: {
        projectId: "p1",
        characters: [],
        scenes: [],
        props: [],
        audios: [],
      },
    });
    expect(result.writeRequired).toBe(true);
    if (!result.writeRequired) return;
    expect(result.result.ok).toBe(true);
    if (!result.result.ok) return;
    expect(result.result.skipped).toEqual([]);
    expect(result.result.counts.created).toBe(1);
    expect(result.result.record.status).toBe("confirmed");
    expect(result.nextBundle.props).toHaveLength(1);
    expect(result.nextBundle.props[0]?.status).toBe("draft");
  });

  it("PUT rejects injecting unknown approvedMediaId", async () => {
    await saveAssetBundleDraft({
      projectId: "p1",
      characters: [baseCharacter()],
      scenes: [],
      props: [],
      audios: [],
    });
    const previous = await loadAssetBundleDraft("p1");
    const result = await validateAssetBundlePutTransition({
      projectId: "p1",
      previous,
      next: {
        projectId: "p1",
        characters: [
          baseCharacter({
            approvedMediaIds: ["media_primary", "injected_uncert"],
            historyMediaIds: ["injected_uncert"],
          }),
        ],
        scenes: [],
        props: [],
        audios: [],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MEDIA_INJECTION_FORBIDDEN");
  });

  it("PUT allows text-only edits on imageless legacy scene", async () => {
    const legacy = {
      id: "scene_legacy",
      projectId: "p1",
      name: "旧场景",
      sceneType: "",
      description: "旧描述",
      timeOfDay: "",
      location: "",
      style: "",
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "draft" as const,
    };
    await saveAssetBundleDraft({
      projectId: "p1",
      characters: [],
      scenes: [legacy],
      props: [],
      audios: [],
    });
    const previous = await loadAssetBundleDraft("p1");
    const result = await validateAssetBundlePutTransition({
      projectId: "p1",
      previous,
      next: {
        projectId: "p1",
        characters: [],
        scenes: [{ ...legacy, description: "仅改文本" }],
        props: [],
        audios: [],
      },
    });
    expect(result.ok).toBe(true);
  });

  it("PUT rejects existing scene pointing primaryMediaId at missing Blob", async () => {
    const { writeProjectAssetImageFile } = await import(
      "@/projects/assets/asset-image-storage"
    );
    await writeProjectAssetImageFile({
      projectId: "p1",
      assetId: "scene_img_ok",
      buffer: PNG_BYTES,
      mimeType: "image/png",
    });
    const scene = {
      id: "scene_1",
      projectId: "p1",
      name: "有图场景",
      sceneType: "",
      description: "",
      timeOfDay: "",
      location: "",
      style: "",
      imageFileName: "scene_img_ok",
      imageObjectUrl: null,
      imageMimeType: "image/png",
      primaryMediaId: "scene_img_ok",
      approvedMediaIds: ["scene_img_ok"],
      status: "completed" as const,
    };
    await saveAssetBundleDraft({
      projectId: "p1",
      characters: [],
      scenes: [scene],
      props: [],
      audios: [],
    });
    const previous = await loadAssetBundleDraft("p1");
    const result = await validateAssetBundlePutTransition({
      projectId: "p1",
      previous,
      next: {
        projectId: "p1",
        characters: [],
        scenes: [
          {
            ...scene,
            primaryMediaId: "missing_blob_key",
            imageFileName: "missing_blob_key",
            approvedMediaIds: ["missing_blob_key"],
          },
        ],
        props: [],
        audios: [],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("IMAGE_REQUIRED");
  });

  it("batch promote only processes selected itemIds", async () => {
    const { transformEpisodeAssetDesignConfirmation } = await import(
      "@/projects/assets/episode-design/confirm-transform"
    );
    const result = transformEpisodeAssetDesignConfirmation({
      projectId: "p1",
      episodeId: "ep1",
      expectedRevision: 1,
      userId: "u1",
      fingerprint,
      itemIds: ["i_prop"],
      store: {
        projectId: "p1",
        updatedAt: new Date().toISOString(),
        records: [
          {
            episodeId: "ep1",
            episodeNumber: 1,
            status: "review",
            revision: 1,
            contentFingerprint: fingerprint,
            generationId: null,
            items: [
              {
                id: "i_prop",
                assetType: "prop",
                name: "选中道具",
                resolution: "create_new",
                source: "ai",
                draft: {
                  description: "道具",
                  propType: "",
                  usage: "",
                  usageInEpisode: "",
                  evidence: "",
                },
                existingAssetId: null,
                libraryAssetId: null,
                note: "",
                generatedMedia: {
                  currentId: "gen_prop_1",
                  historyIds: ["gen_prop_1"],
                  history: [
                    {
                      mediaId: "gen_prop_1",
                      prompt: "道具",
                      generatedAt: new Date().toISOString(),
                      mimeType: "image/webp",
                    },
                  ],
                  status: "completed",
                  promptFingerprint: "fp",
                  errorMessage: null,
                  mimeType: "image/webp",
                  previewKind: "image",
                },
              },
              {
                id: "i_scene",
                assetType: "scene",
                name: "未选中场景",
                resolution: "create_new",
                source: "ai",
                draft: {
                  description: "场景",
                  timeOfDay: "",
                  location: "",
                  style: "",
                  usageInEpisode: "",
                  evidence: "",
                },
                existingAssetId: null,
                libraryAssetId: null,
                note: "",
                generatedMedia: {
                  currentId: "gen_scene_1",
                  historyIds: ["gen_scene_1"],
                  history: [
                    {
                      mediaId: "gen_scene_1",
                      prompt: "场景",
                      generatedAt: new Date().toISOString(),
                      mimeType: "image/webp",
                    },
                  ],
                  status: "completed",
                  promptFingerprint: "fp",
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
          },
        ],
      },
      bundle: {
        projectId: "p1",
        characters: [],
        scenes: [],
        props: [],
        audios: [],
      },
    });
    expect(result.writeRequired).toBe(true);
    if (!result.writeRequired) return;
    expect(result.result.counts.created).toBe(1);
    expect(result.result.record.items.find((item) => item.id === "i_prop")?.libraryAssetId).toBeTruthy();
    expect(result.result.record.items.find((item) => item.id === "i_scene")?.libraryAssetId).toBeNull();
    expect(result.result.record.status).toBe("review");
  });
});
