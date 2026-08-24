import { describe, expect, it, vi, beforeEach } from "vitest";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";

vi.mock("@/video-generation/provider/sd2-platform-config", () => ({
  resolveSd2PlatformCredentials: vi.fn(),
}));
vi.mock("@/video-generation/provider/sd2-platform-client", () => ({
  materializeSd2AssetRef: vi.fn(),
}));

describe("personal video SD2 person verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses SD2 platform credentials like asset design precheck", async () => {
    const { resolveSd2PlatformCredentials } = await import(
      "@/video-generation/provider/sd2-platform-config"
    );
    const { materializeSd2AssetRef } = await import(
      "@/video-generation/provider/sd2-platform-client"
    );
    const { precheckPersonalVideoReferenceImage, isPersonalVideoReferenceBlocked } =
      await import("@/personal/video-generation/precheck-reference");

    vi.mocked(resolveSd2PlatformCredentials).mockResolvedValue({
      apiUrl: "http://sd2.example",
      apiKey: "test-key",
      source: "sd2-platform",
    });
    vi.mocked(materializeSd2AssetRef).mockResolvedValue({
      assetId: "asset_1",
      sourceUrl: "http://sd2.example/asset_1",
    });

    const safety = await precheckPersonalVideoReferenceImage({
      buffer: Buffer.from("png"),
      mimeType: "image/png",
      label: "ref.png",
    });

    expect(materializeSd2AssetRef).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: "http://sd2.example",
        apiKey: "test-key",
        realPerson: true,
        label: "ref.png",
      }),
    );
    expect(safety.status).toBe("ok");
    expect(safety.modelId).toBe(SD2_CERT_MODEL_TAG);
    expect(isPersonalVideoReferenceBlocked(safety)).toBe(false);
  });

  it("blocks generation when SD2 cert is rejected", async () => {
    const { resolveSd2PlatformCredentials } = await import(
      "@/video-generation/provider/sd2-platform-config"
    );
    const { materializeSd2AssetRef } = await import(
      "@/video-generation/provider/sd2-platform-client"
    );
    const { precheckPersonalVideoReferenceImage, isPersonalVideoReferenceBlocked } =
      await import("@/personal/video-generation/precheck-reference");

    vi.mocked(resolveSd2PlatformCredentials).mockResolvedValue({
      apiUrl: "http://sd2.example",
      apiKey: "test-key",
      source: "sd2-platform",
    });
    vi.mocked(materializeSd2AssetRef).mockRejectedValue(
      Object.assign(new Error("真人素材认证失败"), {
        code: "SD2_REAL_PERSON_CERT_FAILED",
      }),
    );

    const safety = await precheckPersonalVideoReferenceImage({
      buffer: Buffer.from("png"),
      mimeType: "image/png",
    });

    expect(safety.status).toBe("likely_real_person");
    expect(isPersonalVideoReferenceBlocked(safety)).toBe(true);
  });

  it("reports missing SD2 platform configuration", async () => {
    const { resolveSd2PlatformCredentials } = await import(
      "@/video-generation/provider/sd2-platform-config"
    );
    const { precheckPersonalVideoReferenceImage, isPersonalVideoReferenceBlocked } =
      await import("@/personal/video-generation/precheck-reference");

    vi.mocked(resolveSd2PlatformCredentials).mockResolvedValue({
      error:
        "人物校验需要移动 SD2 平台。请到「系统管理 → API 接口 → 移动 SD2 平台」填写平台 URL 与 Key（视频镜头可继续用方舟）",
    });

    const safety = await precheckPersonalVideoReferenceImage({
      buffer: Buffer.from("png"),
      mimeType: "image/png",
    });

    expect(safety.status).toBe("check_failed");
    expect(safety.reason).toContain("移动 SD2 平台");
    expect(isPersonalVideoReferenceBlocked(safety)).toBe(true);
  });
});
