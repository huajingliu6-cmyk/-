import type {
  ModelCapability,
  ProviderCapabilities,
  VideoProviderId,
  WanGenerationMode,
} from "./types";

const WAN_PRICING =
  "预计费用请以阿里云百炼当前价格和控制台实际结算为准。输出 URL 有效期约 24 小时。";

function wanBase(): Omit<
  ModelCapability,
  "mode" | "modelId" | "supportsReferenceImages" | "supportsReferenceVideos" | "supportsFirstFrame" | "supportsReferenceVoice" | "maxDurationWithReferenceVideoSeconds"
> {
  return {
    providerId: "aliyun-wan27",
    supportedResolutions: ["720P", "1080P"],
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    minDurationSeconds: 2,
    maxDurationSeconds: 15,
    durationStep: 1,
    maxReferenceMedia: 5,
    maxFirstFrames: 1,
    supportsCancellation: true,
    cancellationStatuses: ["PENDING"],
    resultUrlExpires: "24h",
    nativeResolution: true,
    pricingNotice: WAN_PRICING,
  };
}

/** 万相 2.7 T2V — 依据官方文生视频文档 */
export function getWan27T2VCapability(modelId: string): ModelCapability {
  return {
    ...wanBase(),
    modelId,
    mode: "textToVideo",
    maxDurationWithReferenceVideoSeconds: 15,
    supportsReferenceImages: false,
    supportsReferenceVideos: false,
    supportsFirstFrame: false,
    supportsReferenceVoice: false,
  };
}

/** 万相 2.7 R2V — 依据官方参考生视频文档 */
export function getWan27R2VCapability(modelId: string): ModelCapability {
  return {
    ...wanBase(),
    modelId,
    mode: "referenceToVideo",
    maxDurationWithReferenceVideoSeconds: 10,
    supportsReferenceImages: true,
    supportsReferenceVideos: true,
    supportsFirstFrame: true,
    supportsReferenceVoice: true,
  };
}

const CANVAS_RESOLUTIONS = ["480P", "720P", "1080P"] as const;

/** Mock 与真实模型共用同一份能力边界，保证测试行为一致 */
export function getMockCapabilities(): ProviderCapabilities {
  const t2v = getWan27T2VCapability("mock-wan27-t2v");
  const r2v = getWan27R2VCapability("mock-wan27-r2v");
  return {
    providerId: "mock",
    modes: ["textToVideo", "referenceToVideo"],
    models: [
      {
        ...t2v,
        providerId: "mock",
        supportedResolutions: [...CANVAS_RESOLUTIONS],
        pricingNotice: "Mock 模式不计费。",
      },
      {
        ...r2v,
        providerId: "mock",
        supportedResolutions: [...CANVAS_RESOLUTIONS],
        pricingNotice: "Mock 模式不计费。",
      },
    ],
  };
}

/** 后台「管理 API」HTTP 视频接口：能力边界与万相对齐，便于同一套校验 */
export function getHttpCapabilities(params?: {
  t2vModelId?: string;
  r2vModelId?: string;
}): ProviderCapabilities {
  const t2vModelId = params?.t2vModelId ?? "http-video-t2v";
  const r2vModelId = params?.r2vModelId ?? "http-video-r2v";
  const t2v = getWan27T2VCapability(t2vModelId);
  const r2v = getWan27R2VCapability(r2vModelId);
  const withSeedanceLimits = (cap: ModelCapability): ModelCapability => {
    if (!/seedance/i.test(cap.modelId)) return cap;
    return {
      ...cap,
      minDurationSeconds: 4,
      maxDurationSeconds: 15,
      maxDurationWithReferenceVideoSeconds: 15,
    };
  };
  return {
    providerId: "http",
    modes: ["textToVideo", "referenceToVideo"],
    models: [
      {
        ...withSeedanceLimits(t2v),
        providerId: "http",
        supportedResolutions: [...CANVAS_RESOLUTIONS],
        pricingNotice: "费用以所配置的 HTTP 视频接口为准。",
      },
      {
        ...withSeedanceLimits(r2v),
        providerId: "http",
        supportedResolutions: [...CANVAS_RESOLUTIONS],
        pricingNotice: "费用以所配置的 HTTP 视频接口为准。",
      },
    ],
  };
}

export function getAliyunWan27Capabilities(params: {
  t2vModelId: string;
  r2vModelId: string;
}): ProviderCapabilities {
  return {
    providerId: "aliyun-wan27",
    modes: ["textToVideo", "referenceToVideo"],
    models: [
      getWan27T2VCapability(params.t2vModelId),
      getWan27R2VCapability(params.r2vModelId),
    ],
  };
}

export function pickCapability(
  capabilities: ProviderCapabilities,
  mode: WanGenerationMode,
): ModelCapability {
  const hit = capabilities.models.find((m) => m.mode === mode);
  if (!hit) {
    throw new Error(`未找到模式 ${mode} 的模型能力配置`);
  }
  return hit;
}

export function listCapabilitiesForProvider(
  providerId: VideoProviderId,
  modelIds?: { t2vModelId: string; r2vModelId: string },
): ProviderCapabilities {
  if (providerId === "mock") return getMockCapabilities();
  if (providerId === "http") {
    return getHttpCapabilities({
      t2vModelId: modelIds?.t2vModelId ?? "http-video-t2v",
      r2vModelId: modelIds?.r2vModelId ?? "http-video-r2v",
    });
  }
  return getAliyunWan27Capabilities({
    t2vModelId: modelIds?.t2vModelId ?? "wan2.7-t2v-2026-06-12",
    r2vModelId: modelIds?.r2vModelId ?? "wan2.7-r2v-2026-06-12",
  });
}

export {
  WAN27_DEFAULT_T2V_MODEL_ID,
  WAN27_DEFAULT_R2V_MODEL_ID,
} from "./provider/wan27-constants";
