import { describe, expect, it, vi } from "vitest";
import { HttpVideoProvider } from "@/video-generation/provider/http-video-provider";
import type { ProviderGenerationInput } from "@/video-generation/types";
import type { VideoProviderRuntimeConfig } from "@/video-generation/provider/config";

function httpConfig(
  overrides: Partial<VideoProviderRuntimeConfig> = {},
): VideoProviderRuntimeConfig {
  return {
    providerId: "http",
    allowPaidGeneration: false,
    dashscopeApiKey: "",
    dashscopeWorkspaceId: "",
    dashscopeRegion: "cn-beijing",
    t2vModelId: "mock-t2v",
    r2vModelId: "mock-r2v",
    httpApiUrl: "https://api.sd2.example/v1/video/generations",
    httpApiKey: "sk-test",
    httpModelId: "doubao-seedance-2.0",
    ...overrides,
  };
}

function baseInput(
  overrides?: Partial<ProviderGenerationInput>,
): ProviderGenerationInput {
  return {
    generationId: "gen-sd2-1",
    input: {
      projectId: "p1",
      shotId: "shot-1",
      prompt: "人物在街景中行走",
      negativePrompt: "",
      resolution: "720P",
      aspectRatio: "16:9",
      durationSeconds: 5,
      seed: undefined,
      watermark: false,
      promptExtend: false,
      characterReferences: [],
      sceneReferences: [],
      imageReferences: [],
      referenceVideos: [],
      orderedReferenceMedia: [],
      referenceSelectionMode: "auto",
      selectedReferenceAssetIds: [],
      textInputs: [],
    },
    capability: {
      providerId: "http",
      modelId: "doubao-seedance-2.0",
      mode: "referenceToVideo",
      supportedResolutions: ["720P"],
      supportedAspectRatios: ["16:9"],
      minDurationSeconds: 4,
      maxDurationSeconds: 15,
      maxDurationWithReferenceVideoSeconds: 15,
      durationStep: 1,
      supportsReferenceImages: true,
      supportsReferenceVideos: true,
      supportsFirstFrame: true,
      supportsReferenceVoice: false,
      maxReferenceMedia: 9,
      maxFirstFrames: 1,
      supportsCancellation: false,
      cancellationStatuses: [],
      resultUrlExpires: "",
      nativeResolution: true,
      pricingNotice: "",
    },
    resolvedMedia: [
      {
        type: "reference_image",
        url: "data:image/png;base64,aaa",
        assetId: "char_1",
        label: "江辰",
        kind: "character",
        realPersonCandidate: true,
      },
    ],
    ...overrides,
  };
}

describe("HttpVideoProvider SD2 dialect", () => {
  it("uploads real-person asset, waits active, creates with asset://", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body
            ? "[form]"
            : undefined;
      calls.push({ url: String(url), method, body });

      if (String(url).includes("/api/real-person-assets/upload")) {
        return new Response(
          JSON.stringify({
            row: {
              assetKey: "asset_rp_1",
              assetRef: "asset://asset_rp_1",
              requiresCertification: true,
              purpose: "real_person",
            },
          }),
          { status: 200 },
        );
      }
      if (String(url).includes("/api/assets/asset_rp_1")) {
        return new Response(
          JSON.stringify({
            row: {
              assetKey: "asset_rp_1",
              certifications: [{ interfaceCode: "videoGeneration", status: "active" }],
            },
          }),
          { status: 200 },
        );
      }
      if (
        method === "POST" &&
        String(url).endsWith("/v1/video/generations")
      ) {
        expect(init?.headers).toMatchObject(
          expect.objectContaining({
            "Idempotency-Key": "gen-sd2-1",
          }),
        );
        const parsed = JSON.parse(String(init?.body ?? "{}")) as {
          content: Array<{ image_url?: { url?: string } }>;
          model: string;
          ratio?: string;
        };
        expect(parsed.model).toBe("doubao-seedance-2.0");
        expect(parsed.ratio).toBe("16:9");
        expect(parsed.content.some((c) => c.image_url?.url === "asset://asset_rp_1")).toBe(
          true,
        );
        expect(parsed.content.every((c) => !String(c.image_url?.url ?? "").startsWith("data:"))).toBe(
          true,
        );
        return new Response(JSON.stringify({ id: "task_sd2_1", status: "queued" }), {
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    });

    const config = httpConfig();
    const provider = new HttpVideoProvider({ config, fetchImpl: fetchImpl as never });
    const result = await provider.submitGeneration(baseInput());
    expect(result.providerTaskId).toBe("http-sd2-task_sd2_1");
    expect(calls.some((c) => c.url.includes("/api/real-person-assets/upload"))).toBe(
      true,
    );
    expect(calls.some((c) => c.url.endsWith("/v1/video/generations") && c.method === "POST")).toBe(
      true,
    );
  });

  it("uses normal asset upload when not real-person candidate", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/assets/upload")) {
        return new Response(
          JSON.stringify({
            row: {
              assetKey: "asset_n_1",
              assetRef: "asset://asset_n_1",
            },
          }),
          { status: 200 },
        );
      }
      if (String(url).includes("/api/real-person-assets/upload")) {
        return new Response("should not call", { status: 500 });
      }
      if (
        (init?.method ?? "GET").toUpperCase() === "POST" &&
        String(url).endsWith("/v1/video/generations")
      ) {
        return new Response(JSON.stringify({ id: "task_n_1" }), { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    });

    process.env.VIDEO_SHOT_HTTP_DIALECT = "sd2";
    try {
      const provider = new HttpVideoProvider({
        config: httpConfig({
          httpApiUrl: "https://api.sd2.example",
        }),
        fetchImpl: fetchImpl as never,
      });

      const result = await provider.submitGeneration(
        baseInput({
          resolvedMedia: [
            {
              type: "reference_image",
              url: "data:image/png;base64,bbb",
              assetId: "scene_1",
              label: "巷口",
              kind: "scene",
              realPersonCandidate: false,
            },
          ],
        }),
      );
      expect(result.providerTaskId).toBe("http-sd2-task_n_1");
      expect(
        fetchImpl.mock.calls.some((c) =>
          String(c[0]).includes("/api/assets/upload"),
        ),
      ).toBe(true);
    } finally {
      delete process.env.VIDEO_SHOT_HTTP_DIALECT;
    }
  });

  it("blocks submit when real-person certification fails", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/api/real-person-assets/upload")) {
        return new Response(
          JSON.stringify({
            row: {
              assetKey: "asset_rp_fail",
              assetRef: "asset://asset_rp_fail",
              requiresCertification: true,
            },
          }),
          { status: 200 },
        );
      }
      if (String(url).includes("/api/assets/asset_rp_fail")) {
        return new Response(
          JSON.stringify({
            row: {
              assetKey: "asset_rp_fail",
              certifications: [
                { interfaceCode: "videoGeneration", status: "failed" },
              ],
              assetCertification: { status: "failed", message: "人脸不符" },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("unexpected", { status: 500 });
    });

    const provider = new HttpVideoProvider({
      config: httpConfig(),
      fetchImpl: fetchImpl as never,
    });

    await expect(provider.submitGeneration(baseInput())).rejects.toMatchObject({
      code: "SD2_REAL_PERSON_CERT_FAILED",
      message: expect.stringContaining("认证失败"),
    });
  });

  it("blocks submit when real-person certification is blocked", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/api/real-person-assets/upload")) {
        return new Response(
          JSON.stringify({
            row: {
              assetKey: "asset_rp_block",
              assetRef: "asset://asset_rp_block",
              requiresCertification: true,
            },
          }),
          { status: 200 },
        );
      }
      if (String(url).includes("/api/assets/asset_rp_block")) {
        return new Response(
          JSON.stringify({
            row: {
              certifications: [
                { interfaceCode: "videoGeneration", status: "blocked" },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response("unexpected", { status: 500 });
    });

    const provider = new HttpVideoProvider({
      config: httpConfig(),
      fetchImpl: fetchImpl as never,
    });

    await expect(provider.submitGeneration(baseInput())).rejects.toMatchObject({
      code: "SD2_REAL_PERSON_CERT_BLOCKED",
    });
  });

  it("surfaces readable 401 auth errors instead of [object Object]", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/api/real-person-assets/upload")) {
        return new Response(
          JSON.stringify({
            error: { message: "invalid api key", code: "unauthorized" },
          }),
          { status: 401 },
        );
      }
      return new Response("unexpected", { status: 500 });
    });

    const provider = new HttpVideoProvider({
      config: httpConfig({
        httpApiKey: "sk-wrong-key",
      }),
      fetchImpl: fetchImpl as never,
    });

    await expect(provider.submitGeneration(baseInput())).rejects.toThrow(
      /401.*invalid api key.*VideoFee|移动 SD2/,
    );
  });
});
