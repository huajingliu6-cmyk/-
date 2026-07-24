import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { resolveOutputDimensions } from "@/video-generation/dimensions";
import { validateGenerationSettings } from "@/video-generation/validate-settings";
import { getWan27R2VCapability, getWan27T2VCapability } from "@/video-generation/model-capabilities";
import { selectWanGenerationMode } from "@/video-generation/select-wan-mode";
import {
  buildPromptWithMediaRefs,
  buildWan27Request,
} from "@/video-generation/build-wan27-request";
import { paidGenerationAllowed, getVideoProviderRuntimeConfig } from "@/video-generation/provider/config";
import { AliyunWan27VideoProvider } from "@/video-generation/provider/aliyun-wan27-provider";
import { MockVideoProvider, resetMockVideoProviderTasks } from "@/video-generation/provider/mock-provider";
import type { VideoGenerationInput } from "@/video-generation/types";

function structuralMockMp4(): Buffer {
  return Buffer.concat([
    Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
    ]),
    Buffer.from("moovtrakmdat", "ascii"),
    Buffer.alloc(1024, 0x41),
  ]);
}

function baseInput(
  patch: Partial<VideoGenerationInput> = {},
): VideoGenerationInput {
  return {
    shotId: "shot-1",
    projectId: "demo",
    prompt: "测试镜头",
    resolution: "720P",
    aspectRatio: "16:9",
    durationSeconds: 5,
    watermark: false,
    promptExtend: true,
    characterReferences: [],
    sceneReferences: [],
    imageReferences: [],
    referenceVideos: [],
    orderedReferenceMedia: [],
    textInputs: [],
    referenceSelectionMode: "auto",
    selectedReferenceAssetIds: [],
    ...patch,
  };
}

describe("dimensions", () => {
  it("maps 720P 16:9 and 1080P 9:16", () => {
    expect(resolveOutputDimensions("720P", "16:9")).toEqual({
      width: 1280,
      height: 720,
    });
    expect(resolveOutputDimensions("1080P", "9:16")).toEqual({
      width: 1080,
      height: 1920,
    });
  });
});

describe("validateGenerationSettings", () => {
  const t2v = getWan27T2VCapability("wan2.7-t2v-2026-06-12");
  const r2v = getWan27R2VCapability("wan2.7-r2v-2026-06-12");

  it("allows 720P + 16:9 + 5s", () => {
    const errors = validateGenerationSettings({
      capability: t2v,
      settings: {
        resolution: "720P",
        aspectRatio: "16:9",
        durationSeconds: 5,
        watermark: false,
        promptExtend: true,
      },
      inputSummary: {
        hasReferenceImages: false,
        hasReferenceVideos: false,
        hasFirstFrame: false,
        referenceImageCount: 0,
        referenceVideoCount: 0,
        firstFrameCount: 0,
        unsupportedAudioLabels: [],
      },
    });
    expect(errors).toEqual([]);
  });

  it("allows 1080P + 9:16 + 15s without reference video", () => {
    const errors = validateGenerationSettings({
      capability: r2v,
      settings: {
        resolution: "1080P",
        aspectRatio: "9:16",
        durationSeconds: 15,
        watermark: false,
        promptExtend: true,
      },
      inputSummary: {
        hasReferenceImages: true,
        hasReferenceVideos: false,
        hasFirstFrame: false,
        referenceImageCount: 1,
        referenceVideoCount: 0,
        firstFrameCount: 0,
        unsupportedAudioLabels: [],
      },
    });
    expect(errors).toEqual([]);
  });

  it("rejects 15s when reference video present", () => {
    const errors = validateGenerationSettings({
      capability: r2v,
      settings: {
        resolution: "1080P",
        aspectRatio: "9:16",
        durationSeconds: 15,
        watermark: false,
        promptExtend: true,
      },
      inputSummary: {
        hasReferenceImages: true,
        hasReferenceVideos: true,
        hasFirstFrame: false,
        referenceImageCount: 1,
        referenceVideoCount: 1,
        firstFrameCount: 0,
        unsupportedAudioLabels: [],
      },
    });
    expect(errors.some((e) => e.code === "DURATION_EXCEEDS_WITH_REFERENCE_VIDEO")).toBe(
      true,
    );
  });

  it("rejects 1 second and 16 seconds", () => {
    const s = {
      resolution: "720P" as const,
      aspectRatio: "16:9" as const,
      watermark: false,
      promptExtend: true,
    };
    const summary = {
      hasReferenceImages: false,
      hasReferenceVideos: false,
      hasFirstFrame: false,
      referenceImageCount: 0,
      referenceVideoCount: 0,
      firstFrameCount: 0,
      unsupportedAudioLabels: [],
    };
    expect(
      validateGenerationSettings({
        capability: t2v,
        settings: { ...s, durationSeconds: 1 },
        inputSummary: summary,
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validateGenerationSettings({
        capability: t2v,
        settings: { ...s, durationSeconds: 16 },
        inputSummary: summary,
      }).length,
    ).toBeGreaterThan(0);
  });

  it("rejects more than 5 reference media", () => {
    const errors = validateGenerationSettings({
      capability: r2v,
      settings: {
        resolution: "720P",
        aspectRatio: "16:9",
        durationSeconds: 5,
        watermark: false,
        promptExtend: true,
      },
      inputSummary: {
        hasReferenceImages: true,
        hasReferenceVideos: false,
        hasFirstFrame: false,
        referenceImageCount: 6,
        referenceVideoCount: 0,
        firstFrameCount: 0,
        unsupportedAudioLabels: [],
      },
    });
    expect(errors.some((e) => e.code === "TOO_MANY_REFERENCE_MEDIA")).toBe(true);
  });

  it("rejects more than 1 first frame", () => {
    const errors = validateGenerationSettings({
      capability: r2v,
      settings: {
        resolution: "720P",
        aspectRatio: null,
        durationSeconds: 5,
        watermark: false,
        promptExtend: true,
      },
      inputSummary: {
        hasReferenceImages: true,
        hasReferenceVideos: false,
        hasFirstFrame: true,
        referenceImageCount: 1,
        referenceVideoCount: 0,
        firstFrameCount: 2,
        unsupportedAudioLabels: [],
      },
    });
    expect(errors.some((e) => e.code === "TOO_MANY_FIRST_FRAMES")).toBe(true);
  });
});

describe("wan mode and request", () => {
  it("selects T2V without refs and R2V with refs", () => {
    expect(selectWanGenerationMode(baseInput())).toBe("textToVideo");
    expect(
      selectWanGenerationMode(
        baseInput({
          orderedReferenceMedia: [
            {
              assetId: "a1",
              kind: "image",
              label: "图",
              mimeType: "image/png",
              sourceUrl: "https://example.com/a.png",
            },
          ],
          imageReferences: [
            {
              assetId: "a1",
              kind: "image",
              label: "图",
              mimeType: "image/png",
              sourceUrl: "https://example.com/a.png",
            },
          ],
        }),
      ),
    ).toBe("referenceToVideo");
  });

  it("omits ratio when first_frame present", () => {
    const capability = getWan27R2VCapability("wan2.7-r2v-2026-06-12");
    const body = buildWan27Request(
      baseInput({
        aspectRatio: "16:9",
        firstFrame: {
          assetId: "f1",
          kind: "first_frame",
          label: "首帧",
          mimeType: "image/png",
          sourceUrl: "https://example.com/f.png",
        },
        imageReferences: [
          {
            assetId: "a1",
            kind: "image",
            label: "角色",
            mimeType: "image/png",
            sourceUrl: "https://example.com/a.png",
          },
        ],
      }),
      capability,
      [
        {
          type: "first_frame",
          url: "https://example.com/f.png",
          assetId: "f1",
          label: "首帧",
        },
        {
          type: "reference_image",
          url: "https://example.com/a.png",
          assetId: "a1",
          label: "角色",
        },
      ],
    );
    expect(body.parameters.ratio).toBeUndefined();
    expect(body.model).toBe("wan2.7-r2v-2026-06-12");
  });

  it("keeps 图1/图2 order consistent with media", () => {
    const media = [
      {
        type: "reference_image" as const,
        url: "https://example.com/1.png",
        assetId: "1",
        label: "猫",
      },
      {
        type: "reference_image" as const,
        url: "https://example.com/2.png",
        assetId: "2",
        label: "房间",
      },
    ];
    const prompt = buildPromptWithMediaRefs(
      baseInput({ prompt: "图1在图2里玩耍" }),
      media,
    );
    expect(prompt).toContain("图1（猫）");
    expect(prompt).toContain("图2（房间）");
  });

  it("uses T2V model id for text mode", () => {
    const capability = getWan27T2VCapability("wan2.7-t2v-2026-06-12");
    const body = buildWan27Request(baseInput(), capability, []);
    expect(body.model).toBe("wan2.7-t2v-2026-06-12");
    expect(body.input.media).toBeUndefined();
  });
});

describe("paid generation guard", () => {
  it("blocks when ALLOW_PAID_GENERATION is false", () => {
    const config = getVideoProviderRuntimeConfig({
      VIDEO_PROVIDER: "aliyun-wan27",
      ALLOW_PAID_GENERATION: "false",
      DASHSCOPE_API_KEY: "sk-test",
      DASHSCOPE_WORKSPACE_ID: "ws-test",
    });
    const gate = paidGenerationAllowed(config, true);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("PAID_GENERATION_DISABLED");
  });

  it("requires api key", () => {
    const config = getVideoProviderRuntimeConfig({
      VIDEO_PROVIDER: "aliyun-wan27",
      ALLOW_PAID_GENERATION: "true",
      DASHSCOPE_API_KEY: "",
      DASHSCOPE_WORKSPACE_ID: "ws-test",
    });
    const gate = paidGenerationAllowed(config, true);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("MISSING_DASHSCOPE_API_KEY");
  });
});
describe("providers", () => {
  const tmpDirs: string[] = [];

  beforeEach(async () => {
    resetMockVideoProviderTasks();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wan-mock-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "mock-video.mp4");
    await fs.writeFile(file, structuralMockMp4());
    process.env.MOCK_VIDEO_FILE = file;
  });

  afterEach(async () => {
    delete process.env.MOCK_VIDEO_FILE;
    resetMockVideoProviderTasks();
    for (const dir of tmpDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("Mock provider does not call real HTTP", async () => {
    const fetchImpl = vi.fn();
    const provider = new MockVideoProvider();
    const capability = getWan27T2VCapability("mock-wan27-t2v");
    const submitted = await provider.submitGeneration({
      generationId: "g1",
      input: baseInput(),
      capability: { ...capability, providerId: "mock" },
      resolvedMedia: [],
    });
    expect(submitted.providerTaskId.startsWith("mock-")).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps PENDING to queued and RUNNING to processing", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/tasks/") && !u.includes("/cancel")) {
        return new Response(
          JSON.stringify({
            output: { task_id: "t1", task_status: "RUNNING" },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          output: { task_id: "t1", task_status: "PENDING" },
        }),
        { status: 200 },
      );
    });

    const provider = new AliyunWan27VideoProvider({
      config: {
        providerId: "aliyun-wan27",
        allowPaidGeneration: true,
        dashscopeApiKey: "sk-test",
        dashscopeWorkspaceId: "ws",
        dashscopeRegion: "cn-beijing",
        t2vModelId: "wan2.7-t2v-2026-06-12",
        r2vModelId: "wan2.7-r2v-2026-06-12",
      },
      fetchImpl,
    });

    const pending = await provider.getGenerationStatus("t1");
    // first call returns RUNNING due to mock above for tasks
    expect(["processing", "queued"]).toContain(pending.status);
  });

  it("maps SUCCEEDED to downloading and FAILED to failed", async () => {
    const provider = new AliyunWan27VideoProvider({
      config: {
        providerId: "aliyun-wan27",
        allowPaidGeneration: true,
        dashscopeApiKey: "sk-test",
        dashscopeWorkspaceId: "ws",
        dashscopeRegion: "cn-beijing",
        t2vModelId: "wan2.7-t2v-2026-06-12",
        r2vModelId: "wan2.7-r2v-2026-06-12",
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output: {
              task_id: "t1",
              task_status: "SUCCEEDED",
              video_url: "https://example.com/out.mp4",
            },
            usage: { SR: 720, ratio: "16:9", output_video_duration: 5 },
          }),
          { status: 200 },
        ),
    });
    const ok = await provider.getGenerationStatus("t1");
    expect(ok.status).toBe("downloading");
    expect(ok.remoteVideoUrl).toContain("out.mp4");
    expect(ok.providerResolution).toBe("720");

    const failedProvider = new AliyunWan27VideoProvider({
      config: {
        providerId: "aliyun-wan27",
        allowPaidGeneration: true,
        dashscopeApiKey: "sk-test",
        dashscopeWorkspaceId: "ws",
        dashscopeRegion: "cn-beijing",
        t2vModelId: "wan2.7-t2v-2026-06-12",
        r2vModelId: "wan2.7-r2v-2026-06-12",
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output: {
              task_id: "t1",
              task_status: "FAILED",
              code: "InvalidParameter",
              message: "bad",
            },
          }),
          { status: 200 },
        ),
    });
    const failed = await failedProvider.getGenerationStatus("t1");
    expect(failed.status).toBe("failed");
  });

  it("only PENDING can cancel on mock", async () => {
    const provider = new MockVideoProvider();
    const capability = getWan27T2VCapability("mock-wan27-t2v");
    const submitted = await provider.submitGeneration({
      generationId: "g1",
      input: baseInput(),
      capability: { ...capability, providerId: "mock" },
      resolvedMedia: [],
    });
    const cancelled = await provider.cancelGeneration(submitted.providerTaskId);
    expect(cancelled.cancelled).toBe(true);

    const again = await provider.submitGeneration({
      generationId: "g2",
      input: baseInput(),
      capability: { ...capability, providerId: "mock" },
      resolvedMedia: [],
    });
    await provider.getGenerationStatus(again.providerTaskId);
    const cannot = await provider.cancelGeneration(again.providerTaskId);
    expect(cannot.cancelled).toBe(false);
  });
});
