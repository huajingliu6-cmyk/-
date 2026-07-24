import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveOutputDimensions } from "@/video-generation/dimensions";
import { validateGenerationSettings } from "@/video-generation/validate-settings";
import {
  getWan27T2VCapability,
} from "@/video-generation/model-capabilities";
import {
  buildWan27Request,
  summarizeWan27Request,
} from "@/video-generation/build-wan27-request";
import {
  getPublicVideoConfig,
  getVideoProviderRuntimeConfig,
  buildDashScopeBaseUrl,
  paidGenerationAllowed,
} from "@/video-generation/provider/config";
import { AliyunWan27VideoProvider } from "@/video-generation/provider/aliyun-wan27-provider";
import { buildWan27ProviderReadinessReport } from "@/video-generation/provider/wan27-readiness";
import { buildWan27DryRunPreview } from "@/video-generation/provider/wan27-dry-run";
import { mapWan27ProviderError } from "@/video-generation/provider/wan27-error-map";
import {
  WAN27_RECOMMENDED_POLL_INTERVAL_MS,
  WAN27_CREATE_PATH,
} from "@/video-generation/provider/wan27-constants";
import type { VideoAspectRatio, VideoGenerationInput } from "@/video-generation/types";

function baseInput(
  patch: Partial<VideoGenerationInput> = {},
): VideoGenerationInput {
  return {
    shotId: "shot-1",
    projectId: "demo",
    prompt: "一只小猫在月光下奔跑",
    resolution: "720P",
    aspectRatio: "16:9",
    durationSeconds: 2,
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

const aliyunConfig = {
  providerId: "aliyun-wan27" as const,
  allowPaidGeneration: false,
  dashscopeApiKey: "sk-test",
  dashscopeWorkspaceId: "ws-demo-workspace",
  dashscopeRegion: "cn-beijing" as const,
  t2vModelId: "wan2.7-t2v-2026-06-12",
  r2vModelId: "wan2.7-r2v-2026-06-12",
};

describe("wan27 contract: resolution/ratio (no size)", () => {
  const t2v = getWan27T2VCapability("wan2.7-t2v-2026-06-12");
  const ratios: VideoAspectRatio[] = ["16:9", "9:16", "1:1", "4:3", "3:4"];

  it("builds 720P request with resolution+ratio and no size", () => {
    const body = buildWan27Request(baseInput({ resolution: "720P" }), t2v, []);
    expect(body.parameters.resolution).toBe("720P");
    expect(body.parameters.ratio).toBe("16:9");
    expect(
      Object.prototype.hasOwnProperty.call(body.parameters, "size"),
    ).toBe(false);
    expect(JSON.stringify(body)).not.toContain('"size"');
  });

  it("builds 1080P request with resolution+ratio and no size", () => {
    const body = buildWan27Request(
      baseInput({ resolution: "1080P", durationSeconds: 5 }),
      t2v,
      [],
    );
    expect(body.parameters.resolution).toBe("1080P");
    expect(body.parameters.ratio).toBe("16:9");
    expect(JSON.stringify(body)).not.toContain('"size"');
  });

  it("supports all official aspect ratios with pixel mapping", () => {
    for (const ratio of ratios) {
      const body = buildWan27Request(
        baseInput({ aspectRatio: ratio }),
        t2v,
        [],
      );
      expect(body.parameters.ratio).toBe(ratio);
      const dims = resolveOutputDimensions("720P", ratio);
      expect(dims.width).toBeGreaterThan(0);
      expect(dims.height).toBeGreaterThan(0);
    }
    expect(resolveOutputDimensions("720P", "16:9")).toEqual({
      width: 1280,
      height: 720,
    });
    expect(resolveOutputDimensions("1080P", "3:4")).toEqual({
      width: 1248,
      height: 1648,
    });
  });

  it("accepts min/max duration and rejects out of range", () => {
    const summary = {
      hasReferenceImages: false,
      hasReferenceVideos: false,
      hasFirstFrame: false,
      referenceImageCount: 0,
      referenceVideoCount: 0,
      firstFrameCount: 0,
      unsupportedAudioLabels: [],
    };
    const settingsBase = {
      resolution: "720P" as const,
      aspectRatio: "16:9" as const,
      watermark: false,
      promptExtend: true,
    };
    expect(
      validateGenerationSettings({
        capability: t2v,
        settings: { ...settingsBase, durationSeconds: 2 },
        inputSummary: summary,
      }),
    ).toEqual([]);
    expect(
      validateGenerationSettings({
        capability: t2v,
        settings: { ...settingsBase, durationSeconds: 15 },
        inputSummary: summary,
      }),
    ).toEqual([]);
    expect(
      validateGenerationSettings({
        capability: t2v,
        settings: { ...settingsBase, durationSeconds: 1 },
        inputSummary: summary,
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validateGenerationSettings({
        capability: t2v,
        settings: { ...settingsBase, durationSeconds: 16 },
        inputSummary: summary,
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe("wan27 endpoints and headers", () => {
  it("builds beijing and singapore endpoints", () => {
    expect(
      buildDashScopeBaseUrl({
        workspaceId: "ws-abc",
        region: "cn-beijing",
      }),
    ).toBe("https://ws-abc.cn-beijing.maas.aliyuncs.com");
    expect(
      buildDashScopeBaseUrl({
        workspaceId: "ws-sg",
        region: "ap-southeast-1",
      }),
    ).toBe("https://ws-sg.ap-southeast-1.maas.aliyuncs.com");
  });

  it("fails when workspace missing", () => {
    expect(() =>
      buildDashScopeBaseUrl({ workspaceId: "", region: "cn-beijing" }),
    ).toThrow(/WORKSPACE/);
  });

  it("always sends X-DashScope-Async enable on create", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("X-DashScope-Async")).toBe("enable");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("Authorization")?.startsWith("Bearer ")).toBe(true);
      expect(String(_url)).toContain(WAN27_CREATE_PATH);
      return new Response(
        JSON.stringify({
          output: { task_id: "task-1", task_status: "PENDING" },
          request_id: "req-1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const provider = new AliyunWan27VideoProvider({
      config: aliyunConfig,
      fetchImpl,
    });
    const capability = getWan27T2VCapability(aliyunConfig.t2vModelId);
    await provider.submitGeneration({
      generationId: "g1",
      input: baseInput(),
      capability,
      resolvedMedia: [],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails safely when API key missing", async () => {
    const provider = new AliyunWan27VideoProvider({
      config: { ...aliyunConfig, dashscopeApiKey: "" },
      fetchImpl: vi.fn(),
    });
    await expect(
      provider.submitGeneration({
        generationId: "g1",
        input: baseInput(),
        capability: getWan27T2VCapability(aliyunConfig.t2vModelId),
        resolvedMedia: [],
      }),
    ).rejects.toThrow(/API Key/);
  });

  it("fails when model id missing", async () => {
    const provider = new AliyunWan27VideoProvider({
      config: { ...aliyunConfig, t2vModelId: "", r2vModelId: "" },
      fetchImpl: vi.fn(),
    });
    await expect(
      provider.submitGeneration({
        generationId: "g1",
        input: baseInput(),
        capability: getWan27T2VCapability("x"),
        resolvedMedia: [],
      }),
    ).rejects.toThrow();
  });

  it("fails when task_id missing", async () => {
    const provider = new AliyunWan27VideoProvider({
      config: aliyunConfig,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ output: { task_status: "PENDING" }, request_id: "r" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    await expect(
      provider.submitGeneration({
        generationId: "g1",
        input: baseInput(),
        capability: getWan27T2VCapability(aliyunConfig.t2vModelId),
        resolvedMedia: [],
      }),
    ).rejects.toThrow(/任务 ID/);
  });

  it("fails on non-JSON response without leaking body", async () => {
    const provider = new AliyunWan27VideoProvider({
      config: aliyunConfig,
      fetchImpl: async () =>
        new Response("<html>secret-key-sk-xxx</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    });
    await expect(
      provider.submitGeneration({
        generationId: "g1",
        input: baseInput(),
        capability: getWan27T2VCapability(aliyunConfig.t2vModelId),
        resolvedMedia: [],
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        !message.includes("sk-xxx") &&
        !message.includes("<html>") &&
        message.length < 200
      );
    });
  });
});

describe("wan27 task status mapping", () => {
  function statusProvider(payload: unknown) {
    return new AliyunWan27VideoProvider({
      config: aliyunConfig,
      fetchImpl: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
  }

  it("maps PENDING / RUNNING / SUCCEEDED / FAILED / CANCELED / UNKNOWN", async () => {
    expect(
      (await statusProvider({ output: { task_status: "PENDING" } }).getGenerationStatus("t")).status,
    ).toBe("queued");
    expect(
      (await statusProvider({ output: { task_status: "RUNNING" } }).getGenerationStatus("t")).status,
    ).toBe("processing");
    expect(
      (
        await statusProvider({
          output: {
            task_status: "SUCCEEDED",
            video_url: "https://cdn.example/out.mp4",
          },
          usage: { SR: 720, ratio: "16:9", output_video_duration: 2 },
        }).getGenerationStatus("t")
      ).status,
    ).toBe("downloading");
    expect(
      (
        await statusProvider({
          output: {
            task_status: "FAILED",
            code: "InvalidParameter",
            message: "bad",
          },
        }).getGenerationStatus("t")
      ).status,
    ).toBe("failed");
    expect(
      (await statusProvider({ output: { task_status: "CANCELED" } }).getGenerationStatus("t")).status,
    ).toBe("cancelled");
    const unknown = await statusProvider({
      output: { task_status: "UNKNOWN" },
    }).getGenerationStatus("t");
    expect(unknown.status).toBe("failed");
    expect(unknown.errorCode).toBe("PROVIDER_TASK_UNKNOWN");
    expect(unknown.errorMessage).toMatch(/过期|不存在/);
  });

  it("maps task_id expired style messaging", () => {
    const mapped = mapWan27ProviderError({
      message: "task expired after 24 hours",
    });
    expect(mapped.code).toBe("PROVIDER_TASK_ID_EXPIRED");
  });
});

describe("wan27 error mapping", () => {
  it("maps 401 / 403 / 429 / balance / audit", () => {
    expect(mapWan27ProviderError({ httpStatus: 401, code: "InvalidApiKey" }).userMessage).toMatch(
      /API Key/,
    );
    expect(mapWan27ProviderError({ httpStatus: 403, code: "AccessDenied" }).userMessage).toMatch(
      /无权/,
    );
    expect(
      mapWan27ProviderError({
        httpStatus: 429,
        code: "Throttling.RateQuota",
        message: "Requests rate limit exceeded",
      }).userMessage,
    ).toMatch(/频繁/);
    expect(
      mapWan27ProviderError({
        code: "Arrearage",
        message: "Access denied, please make sure your account is in good standing.",
      }).userMessage,
    ).toMatch(/余额|欠费/);
    expect(
      mapWan27ProviderError({
        code: "DataInspectionFailed",
        message: "Input data may contain inappropriate content.",
      }).userMessage,
    ).toMatch(/审核/);
  });

  it("maps result url expired and allowlist", () => {
    expect(
      mapWan27ProviderError({ code: "RESULT_URL_EXPIRED" }).userMessage,
    ).toMatch(/过期/);
    expect(
      mapWan27ProviderError({
        code: "RESULT_HOST_ALLOWLIST_NOT_CONFIGURED",
      }).userMessage,
    ).toMatch(/白名单/);
  });

  it("maps unknownOutcome without exposing secrets", () => {
    const mapped = mapWan27ProviderError({
      context: "unknownOutcome",
      message: "Bearer sk-secret Authorization https://signed.example/?token=abc",
    });
    expect(mapped.userMessage).not.toContain("sk-secret");
    expect(mapped.userMessage).not.toContain("signed.example");
    expect(mapped.code).toBe("GENERATION_SUBMISSION_UNKNOWN");
  });
});

describe("wan27 readiness + dry run (no network)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(() => {
      throw new Error("network should not be called");
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("readiness does not leak secrets and keeps paid false", () => {
    const report = buildWan27ProviderReadinessReport({
      VIDEO_PROVIDER: "mock",
      ALLOW_PAID_GENERATION: "false",
      DASHSCOPE_API_KEY: "sk-super-secret-key",
      DASHSCOPE_WORKSPACE_ID: "workspace-long-id-value",
      DASHSCOPE_REGION: "cn-beijing",
      WAN_T2V_MODEL_ID: "wan2.7-t2v-2026-06-12",
      WAN_R2V_MODEL_ID: "wan2.7-r2v-2026-06-12",
      WAN_RESULT_ALLOWED_HOSTS: "",
    });
    expect(report.readyForPaidSubmission).toBe(false);
    expect(report.readyForResultTransfer).toBe(false);
    const blob = JSON.stringify(report);
    expect(blob).not.toContain("sk-super-secret-key");
    expect(blob).not.toContain("workspace-long-id-value");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("allowlist empty => readyForResultTransfer false", () => {
    const report = buildWan27ProviderReadinessReport({
      VIDEO_PROVIDER: "mock",
      ALLOW_PAID_GENERATION: "false",
      WAN_RESULT_ALLOWED_HOSTS: "",
    });
    expect(report.readyForResultTransfer).toBe(false);
  });

  it("dry run does not call network or include sensitive fields", () => {
    const preview = buildWan27DryRunPreview({
      input: baseInput({
        prompt: "完整机密提示词不要外泄",
      }),
      resolvedMedia: [
        {
          type: "reference_image",
          url: "data:image/png;base64,AAAASECRET",
          assetId: "a1",
          label: "图",
        },
      ],
      env: {
        VIDEO_PROVIDER: "mock",
        ALLOW_PAID_GENERATION: "false",
        DASHSCOPE_API_KEY: "sk-should-not-appear",
        DASHSCOPE_WORKSPACE_ID: "ws-should-mask",
        DASHSCOPE_REGION: "cn-beijing",
        WAN_T2V_MODEL_ID: "wan2.7-t2v-2026-06-12",
        WAN_R2V_MODEL_ID: "wan2.7-r2v-2026-06-12",
        WAN_RESULT_ALLOWED_HOSTS: "",
      },
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(preview.paidSubmissionAllowed).toBe(false);
    expect(preview.mayIncurCost).toBe(false);
    expect(preview.costStatus).toBe("费用待人工确认");
    expect(preview.noRealRequestNotice).toBe(
      "当前不会发送真实请求，也不会产生费用。",
    );
    expect(preview.promptCharCount).toBeGreaterThan(0);
    expect(preview.promptSafeDigest).toMatch(/^sha256:/);
    const blob = JSON.stringify(preview);
    expect(blob).not.toContain("完整机密提示词不要外泄");
    expect(blob).not.toContain("AAAASECRET");
    expect(blob).not.toContain("sk-should-not-appear");
    expect(blob).not.toContain("data:image/png;base64");
    expect(preview.redaction.includesFullPrompt).toBe(false);
    expect(preview.redaction.includesBase64).toBe(false);
    expect(preview.redaction.includesApiKey).toBe(false);
  });

  it("defaults remain mock / paid false / empty allowlist", () => {
    const config = getVideoProviderRuntimeConfig({
      VIDEO_PROVIDER: undefined,
      ALLOW_PAID_GENERATION: undefined,
      WAN_RESULT_ALLOWED_HOSTS: undefined,
    });
    expect(config.providerId).toBe("mock");
    expect(config.allowPaidGeneration).toBe(false);
    const publicConfig = getPublicVideoConfig({
      VIDEO_PROVIDER: "mock",
      ALLOW_PAID_GENERATION: "false",
    });
    expect(publicConfig.recommendedPollIntervalMs).toBe(3_500);
    expect(
      getPublicVideoConfig({
        VIDEO_PROVIDER: "aliyun-wan27",
        ALLOW_PAID_GENERATION: "false",
      }).recommendedPollIntervalMs,
    ).toBe(WAN27_RECOMMENDED_POLL_INTERVAL_MS);
    expect(
      paidGenerationAllowed(
        getVideoProviderRuntimeConfig({
          VIDEO_PROVIDER: "aliyun-wan27",
          ALLOW_PAID_GENERATION: "false",
          DASHSCOPE_API_KEY: "sk",
          DASHSCOPE_WORKSPACE_ID: "ws",
        }),
        true,
      ).ok,
    ).toBe(false);
  });

  it("summarize request never includes full prompt or auth", () => {
    const body = buildWan27Request(
      baseInput({ prompt: "secret-prompt-value" }),
      getWan27T2VCapability("wan2.7-t2v-2026-06-12"),
      [],
    );
    const summary = summarizeWan27Request(body);
    expect(JSON.stringify(summary)).not.toContain("secret-prompt-value");
    expect(summary).not.toHaveProperty("Authorization");
  });
});
