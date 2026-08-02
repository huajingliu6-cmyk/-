import { afterEach, describe, expect, it } from "vitest";
import {
  resolveVideoProviderRuntimeConfig,
  paidGenerationAllowed,
  getPublicVideoConfigFromRuntime,
} from "@/video-generation/provider/config";
import {
  HttpVideoProvider,
  resetHttpVideoProviderTasks,
} from "@/video-generation/provider/http-video-provider";
import { createVideoProvider } from "@/video-generation/provider";
import { buildTransferSourceFromGeneration } from "@/video-generation/secure-transfer/build-transfer-source";
import {
  getHttpCapabilities,
  pickCapability,
} from "@/video-generation/model-capabilities";
import type { ProviderGenerationInput } from "@/video-generation/types";

afterEach(() => {
  resetHttpVideoProviderTasks();
});

function baseInput(
  resolution: "480P" | "720P" | "1080P" = "720P",
): ProviderGenerationInput {
  const capability = pickCapability(getHttpCapabilities(), "textToVideo");
  return {
    generationId: "gen-1",
    capability,
    resolvedMedia: [],
    input: {
      shotId: "shot-1",
      projectId: "proj-1",
      prompt: "a cat running",
      resolution,
      aspectRatio: "9:16",
      durationSeconds: 5,
      watermark: false,
      promptExtend: true,
      characterReferences: [],
      sceneReferences: [],
      imageReferences: [],
      referenceVideos: [],
      textInputs: [],
      orderedReferenceMedia: [],
      referenceSelectionMode: "auto",
      selectedReferenceAssetIds: [],
    },
  };
}

describe("resolveVideoProviderRuntimeConfig + admin video-shot", () => {
  it("maps admin http video-shot to http provider", async () => {
    const runtime = await resolveVideoProviderRuntimeConfig(
      { VITEST: "true" },
      {
        getVideoShotConfig: async () => ({
          id: "video-shot",
          label: "video",
          description: "test",
          provider: "http",
          apiUrl: "https://example.com/v1/video",
          apiKey: "sk-test-key-demo",
          model: "ep-demo",
          updatedAt: new Date().toISOString(),
        }),
      },
    );
    expect(runtime.providerId).toBe("http");
    expect(runtime.httpApiUrl).toBe("https://example.com/v1/video");
    expect(runtime.httpApiKey).toBe("sk-test-key-demo");
    expect(runtime.httpModelId).toBe("ep-demo");
    expect(runtime.t2vModelId).toBe("ep-demo");
  });

  it("maps admin mock video-shot to mock provider", async () => {
    const runtime = await resolveVideoProviderRuntimeConfig(
      {
        VITEST: "true",
        VIDEO_PROVIDER: "aliyun-wan27",
        DASHSCOPE_API_KEY: "k",
        DASHSCOPE_WORKSPACE_ID: "w",
      },
      {
        getVideoShotConfig: async () => ({
          id: "video-shot",
          label: "video",
          description: "test",
          provider: "mock",
          apiUrl: "",
          apiKey: "",
          model: "",
          updatedAt: new Date().toISOString(),
        }),
      },
    );
    expect(runtime.providerId).toBe("mock");
  });

  it("allows http path without paid confirmation", async () => {
    const runtime = await resolveVideoProviderRuntimeConfig(
      { VITEST: "true" },
      {
        getVideoShotConfig: async () => ({
          id: "video-shot",
          label: "video",
          description: "t",
          provider: "http",
          apiUrl: "https://example.com/gen",
          apiKey: "",
          model: "",
          updatedAt: new Date().toISOString(),
        }),
      },
    );
    expect(paidGenerationAllowed(runtime, false)).toEqual({ ok: true });
    const pub = getPublicVideoConfigFromRuntime(runtime);
    expect(pub.providerId).toBe("http");
    expect(pub.hasEndpoint).toBe(true);
  });

  it("ark base url alone uses default model", async () => {
    const runtime = await resolveVideoProviderRuntimeConfig(
      { VITEST: "true" },
      {
        getVideoShotConfig: async () => ({
          id: "video-shot",
          label: "video",
          description: "t",
          provider: "http",
          apiUrl: "https://ark.cn-beijing.volces.com/api/v3",
          apiKey: "sk-live-demo-key",
          model: "",
          updatedAt: new Date().toISOString(),
        }),
      },
    );
    expect(runtime.httpModelId).toBe("doubao-seedance-2-0-260128");
    expect(paidGenerationAllowed(runtime, false)).toEqual({ ok: true });
  });

  it("rejects url pasted into apiKey field", async () => {
    const runtime = await resolveVideoProviderRuntimeConfig(
      { VITEST: "true" },
      {
        getVideoShotConfig: async () => ({
          id: "video-shot",
          label: "video",
          description: "t",
          provider: "http",
          apiUrl: "https://ark.cn-beijing.volces.com/api/v3",
          apiKey: "https://ark.cn-beijing.volces.com/api/v3",
          model: "ep-demo",
          updatedAt: new Date().toISOString(),
        }),
      },
    );
    expect(runtime.httpApiKey).toBe("");
    const gate = paidGenerationAllowed(runtime, false);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("MISSING_HTTP_VIDEO_API_KEY");
  });
});

describe("HttpVideoProvider", () => {
  it("legacy sync materializes file:// result", async () => {
    const tinyMp4 = Buffer.alloc(64, 1);
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("example.com/v1/video")) {
        return new Response(
          JSON.stringify({
            base64: tinyMp4.toString("base64"),
            mimeType: "video/mp4",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const provider = new HttpVideoProvider({
      config: {
        providerId: "http",
        allowPaidGeneration: false,
        dashscopeApiKey: "",
        dashscopeWorkspaceId: "",
        dashscopeRegion: "cn-beijing",
        t2vModelId: "http-video-t2v",
        r2vModelId: "http-video-r2v",
        httpApiUrl: "https://example.com/v1/video",
        httpApiKey: "sk-test-key",
      },
      fetchImpl,
    });

    const submitted = await provider.submitGeneration(baseInput("720P"));
    expect(submitted.providerTaskId).toMatch(/^http-/);

    const status = await provider.getGenerationStatus(submitted.providerTaskId);
    expect(status.status).toBe("downloading");
    expect(status.providerResolution).toBe("720");
    expect(status.remoteVideoUrl?.startsWith("file://")).toBe(true);

    const source = buildTransferSourceFromGeneration({
      providerId: "http",
      isMock: false,
      remoteVideoUrl: status.remoteVideoUrl!,
    });
    expect(source.kind).toBe("mockFile");
  });

  it("ark dialect sends 480p and polls download", async () => {
    const tinyMp4 = Buffer.alloc(64, 1);
    let createBody: Record<string, unknown> | null = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") {
        createBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ id: "task-480" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/contents/generations/tasks/task-480")) {
        return new Response(
          JSON.stringify({
            status: "succeeded",
            size: "480x854",
            content: { video_url: "https://cdn.example.com/out.mp4" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("cdn.example.com/out.mp4")) {
        return new Response(tinyMp4, {
          status: 200,
          headers: { "Content-Type": "video/mp4" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const provider = new HttpVideoProvider({
      config: {
        providerId: "http",
        allowPaidGeneration: false,
        dashscopeApiKey: "",
        dashscopeWorkspaceId: "",
        dashscopeRegion: "cn-beijing",
        t2vModelId: "ep-demo",
        r2vModelId: "ep-demo",
        httpApiUrl: "https://ark.cn-bejing.volces.com/api/v3",
        httpApiKey: "sk-ark-demo",
        httpModelId: "ep-demo",
      },
      fetchImpl,
    });

    const submitted = await provider.submitGeneration(baseInput("480P"));
    expect(createBody).toMatchObject({
      model: "ep-demo",
      resolution: "480p",
      ratio: "9:16",
      duration: 5,
    });

    const status = await provider.getGenerationStatus(submitted.providerTaskId);
    expect(status.status).toBe("downloading");
    expect(status.providerResolution).toBe("480");
    expect(status.remoteVideoUrl?.startsWith("file://")).toBe(true);
  });

  it("createVideoProvider returns http", () => {
    const provider = createVideoProvider({
      config: {
        providerId: "http",
        allowPaidGeneration: false,
        dashscopeApiKey: "",
        dashscopeWorkspaceId: "",
        dashscopeRegion: "cn-beijing",
        t2vModelId: "http-video-t2v",
        r2vModelId: "http-video-r2v",
        httpApiUrl: "https://example.com/v1/video",
        httpApiKey: "sk",
      },
    });
    expect(provider.id).toBe("http");
  });
});
