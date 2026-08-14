import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  characterNeedsUncheckedVideoRefBlock,
  designVideoRefSafetyBadge,
  formatDesignVideoRefSafetyNotice,
  getCurrentDesignMediaVideoRefSafety,
  isDesignMediaVideoRefLocked,
} from "@/projects/assets/episode-design/design-media-video-ref-labels";
import {
  getDesignMediaVideoRefSafety,
  withGeneratedMediaVideoRefSafety,
} from "@/projects/assets/episode-design/design-media-video-ref-precheck";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import type { VideoRefSafety } from "@/projects/assets/types";
import { readFileSync } from "fs";
import path from "path";

vi.mock("@/video-generation/provider/config", () => ({
  resolveVideoProviderRuntimeConfig: vi.fn(),
}));
vi.mock("@/video-generation/provider/sd2-platform-config", () => ({
  resolveSd2PlatformCredentials: vi.fn(),
}));
vi.mock("@/video-generation/provider/sd2-platform-client", () => ({
  materializeSd2AssetRef: vi.fn(),
}));
vi.mock("@/projects/assets/asset-image-storage", () => ({
  resolveAssetImageFilePath: vi.fn(() => "/tmp/fake.png"),
  readProjectAssetImageMeta: vi.fn(async () => ({ mimeType: "image/png" })),
}));
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(async () => Buffer.from("png")),
    },
  };
});

describe("design media SD2 person verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("labels ok as SD certified and locks", () => {
    const safety = {
      status: "ok" as const,
      checkedAt: new Date().toISOString(),
    };
    expect(designVideoRefSafetyBadge(safety)?.label).toBe("SD 已认证");
    expect(designVideoRefSafetyBadge(safety)?.tone).toBe("ok");
    expect(isDesignMediaVideoRefLocked(safety)).toBe(true);
    expect(formatDesignVideoRefSafetyNotice(safety, "character")).toContain(
      "审核资产库",
    );
  });

  it("labels cert rejection as 疑似真人", () => {
    const safety = {
      status: "likely_real_person" as const,
      checkedAt: new Date().toISOString(),
      reason: "认证失败",
    };
    expect(designVideoRefSafetyBadge(safety)?.label).toBe("疑似真人");
    expect(isDesignMediaVideoRefLocked(safety)).toBe(false);
    expect(
      formatDesignVideoRefSafetyNotice(safety, "character"),
    ).toContain("插画");
  });

  it("attaches safety onto current generated media", () => {
    const safety = {
      status: "ok" as const,
      checkedAt: "2026-07-31T00:00:00.000Z",
    };
    const next = withGeneratedMediaVideoRefSafety(
      {
        currentId: "gen_a",
        historyIds: ["gen_a"],
        history: [
          {
            mediaId: "gen_a",
            prompt: "角色",
            generatedAt: "2026-07-31T00:00:00.000Z",
          },
        ],
        status: "completed",
        promptFingerprint: "x",
        errorMessage: null,
      },
      safety,
    );
    expect(next.videoRefSafety?.status).toBe("ok");
    expect(next.history?.[0]?.videoRefSafety?.status).toBe("ok");
    expect(getDesignMediaVideoRefSafety(next, "gen_a")?.status).toBe("ok");
  });

  it("maps SD2 active → ok and failed → likely_real_person", async () => {
    const { resolveSd2PlatformCredentials } = await import(
      "@/video-generation/provider/sd2-platform-config"
    );
    const { materializeSd2AssetRef } = await import(
      "@/video-generation/provider/sd2-platform-client"
    );
    const { precheckDesignGeneratedMedia } = await import(
      "@/projects/assets/episode-design/design-media-video-ref-precheck"
    );

    vi.mocked(resolveSd2PlatformCredentials).mockResolvedValue({
      apiUrl: "https://api.sd2.example/v1/video/generations",
      apiKey: "sk-test-key-1234567890",
      source: "sd2-platform",
    });

    vi.mocked(materializeSd2AssetRef).mockResolvedValueOnce("asset://ok_1");
    const ok = await precheckDesignGeneratedMedia({
      projectId: "p1",
      mediaId: "gen_1",
    });
    expect(ok.status).toBe("ok");
    expect(materializeSd2AssetRef).toHaveBeenCalledWith(
      expect.objectContaining({ realPerson: true }),
    );

    vi.mocked(materializeSd2AssetRef).mockRejectedValueOnce(
      Object.assign(new Error("真人素材认证失败（江宸）：人脸不符"), {
        code: "SD2_REAL_PERSON_CERT_FAILED",
      }),
    );
    const fail = await precheckDesignGeneratedMedia({
      projectId: "p1",
      mediaId: "gen_2",
    });
    expect(fail.status).toBe("likely_real_person");

    vi.mocked(materializeSd2AssetRef).mockRejectedValueOnce(
      Object.assign(new Error("真人素材认证超时：等待…"), {
        code: "SD2_REAL_PERSON_CERT_TIMEOUT",
      }),
    );
    const timeout = await precheckDesignGeneratedMedia({
      projectId: "p1",
      mediaId: "gen_3",
    });
    expect(timeout.status).toBe("check_failed");
  });

  it("surfaces clear config error when SD2 platform missing", async () => {
    const { resolveSd2PlatformCredentials } = await import(
      "@/video-generation/provider/sd2-platform-config"
    );
    const { precheckDesignGeneratedMedia } = await import(
      "@/projects/assets/episode-design/design-media-video-ref-precheck"
    );
    vi.mocked(resolveSd2PlatformCredentials).mockResolvedValue({
      error:
        "人物校验需要移动 SD2 平台。请到「系统管理 → API 接口 → 移动 SD2 平台」填写平台 URL 与 Key（视频镜头可继续用方舟）",
    });
    const result = await precheckDesignGeneratedMedia({
      projectId: "p1",
      mediaId: "gen_x",
    });
    expect(result.status).toBe("check_failed");
    expect(result.reason).toContain("移动 SD2 平台");
    expect(result.reason).not.toContain("VIDEO_SHOT_HTTP_DIALECT");
  });

  it("modal locks verified button; generate-asset no longer auto-prechecks", () => {
    const modal = readFileSync(
      path.join(process.cwd(), "src/projects/assets/DesignAssetModal.tsx"),
      "utf-8",
    );
    const mgmt = readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-asset/route.ts",
      ),
      "utf-8",
    );
    const workspace = readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/workspace/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-asset/route.ts",
      ),
      "utf-8",
    );
    expect(modal).toContain("design-video-ref-precheck");
    expect(modal).toContain("is-verified");
    expect(modal).toContain("人物校验");
    expect(modal).toContain("isDesignMediaVideoRefLocked");
    expect(mgmt).not.toContain("precheckDesignGeneratedMedia");
    expect(workspace).not.toContain("precheckDesignGeneratedMedia");
    expect(mgmt).toContain("人物校验");
  });
});

describe("characterNeedsUncheckedVideoRefBlock (personal confirm gate)", () => {
  const ok: VideoRefSafety = {
    status: "ok",
    checkedAt: "2026-08-13T00:00:00.000Z",
  };
  const risk: VideoRefSafety = {
    status: "likely_real_person",
    checkedAt: "2026-08-13T00:00:00.000Z",
  };

  function characterItem(
    patch: Partial<EpisodeAssetDesignItem> & {
      generatedMedia?: EpisodeAssetDesignItem["generatedMedia"];
    } = {},
  ): Pick<
    EpisodeAssetDesignItem,
    "assetType" | "generatedMedia" | "libraryAssetId"
  > {
    return {
      assetType: "character",
      libraryAssetId: null,
      generatedMedia: {
        currentId: "gen_current",
        historyIds: ["gen_current"],
        status: "completed",
        promptFingerprint: null,
        errorMessage: null,
        previewKind: "image",
        history: [
          {
            mediaId: "gen_current",
            prompt: "p",
            generatedAt: "2026-08-13T00:00:00.000Z",
          },
        ],
      },
      ...patch,
    };
  }

  it("blocks when current image has no videoRefSafety", () => {
    expect(characterNeedsUncheckedVideoRefBlock(characterItem())).toBe(true);
  });

  it("allows only when current image status is ok", () => {
    expect(
      characterNeedsUncheckedVideoRefBlock(
        characterItem({
          generatedMedia: {
            currentId: "gen_current",
            historyIds: ["gen_current"],
            status: "completed",
            promptFingerprint: null,
            errorMessage: null,
            previewKind: "image",
            videoRefSafety: ok,
            history: [
              {
                mediaId: "gen_current",
                prompt: "p",
                generatedAt: "2026-08-13T00:00:00.000Z",
                videoRefSafety: ok,
              },
            ],
          },
        }),
      ),
    ).toBe(false);
  });

  it("blocks pending / risk / check_failed (not treated as pass)", () => {
    for (const status of [
      "pending",
      "likely_real_person",
      "other_risk",
      "check_failed",
    ] as const) {
      expect(
        characterNeedsUncheckedVideoRefBlock(
          characterItem({
            generatedMedia: {
              currentId: "gen_current",
              historyIds: ["gen_current"],
              status: "completed",
              promptFingerprint: null,
              errorMessage: null,
              previewKind: "image",
              history: [
                {
                  mediaId: "gen_current",
                  prompt: "p",
                  generatedAt: "2026-08-13T00:00:00.000Z",
                  videoRefSafety: {
                    status,
                    checkedAt: "2026-08-13T00:00:00.000Z",
                  },
                },
              ],
            },
          }),
        ),
      ).toBe(true);
    }
  });

  it("blocks when only a historical image is ok, not the current one", () => {
    const item = characterItem({
      generatedMedia: {
        currentId: "gen_new",
        historyIds: ["gen_old", "gen_new"],
        status: "completed",
        promptFingerprint: null,
        errorMessage: null,
        previewKind: "image",
        // Stale top-level from previous current — must not unlock confirm.
        videoRefSafety: ok,
        history: [
          {
            mediaId: "gen_old",
            prompt: "old",
            generatedAt: "2026-08-12T00:00:00.000Z",
            videoRefSafety: ok,
          },
          {
            mediaId: "gen_new",
            prompt: "new",
            generatedAt: "2026-08-13T00:00:00.000Z",
          },
        ],
      },
    });
    expect(getCurrentDesignMediaVideoRefSafety(item.generatedMedia)).toBeNull();
    expect(characterNeedsUncheckedVideoRefBlock(item)).toBe(true);
    // Legacy helper may still see stale top-level; confirm gate must not.
    expect(
      getDesignMediaVideoRefSafety(item.generatedMedia, "gen_new")?.status,
    ).toBe("ok");
  });

  it("does not block scenes/props or already-library characters", () => {
    expect(
      characterNeedsUncheckedVideoRefBlock({
        assetType: "scene",
        libraryAssetId: null,
        generatedMedia: {
          currentId: "s1",
          historyIds: ["s1"],
          status: "completed",
          promptFingerprint: null,
          errorMessage: null,
          previewKind: "image",
        },
      }),
    ).toBe(false);
    expect(
      characterNeedsUncheckedVideoRefBlock({
        assetType: "prop",
        libraryAssetId: null,
        generatedMedia: {
          currentId: "p1",
          historyIds: ["p1"],
          status: "completed",
          promptFingerprint: null,
          errorMessage: null,
          previewKind: "image",
        },
      }),
    ).toBe(false);
    expect(
      characterNeedsUncheckedVideoRefBlock(
        characterItem({ libraryAssetId: "char_lib_1" }),
      ),
    ).toBe(false);
  });

  it("does not block when there is no current image (missing-image path owns that)", () => {
    expect(
      characterNeedsUncheckedVideoRefBlock(
        characterItem({
          generatedMedia: {
            currentId: null,
            historyIds: [],
            status: "idle",
            promptFingerprint: null,
            errorMessage: null,
            previewKind: "image",
          },
        }),
      ),
    ).toBe(false);
  });

  it("risk status is not locked / not a confirm pass", () => {
    expect(isDesignMediaVideoRefLocked(risk)).toBe(false);
  });
});
