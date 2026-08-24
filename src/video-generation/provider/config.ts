import type { GenerationApiConfig } from "@/auth/api-config";
import {
  getGenerationApiConfig,
  isInvalidGenerationApiUrl,
  isPlausibleApiKey,
  looksLikeArkVideoEndpoint,
  normalizeGenerationApiUrl,
} from "@/auth/api-config";
import type { VideoProviderId } from "../types";
import {
  DEFAULT_ARK_VIDEO_MODEL,
  DEFAULT_SD2_VIDEO_MODEL,
  isSd2HttpVideoDialect,
  normalizeArkVideoModelId,
  normalizeSd2VideoModelId,
} from "./http-video-dialect";
import {
  WAN27_DEFAULT_R2V_MODEL_ID,
  WAN27_DEFAULT_T2V_MODEL_ID,
  WAN27_RECOMMENDED_POLL_INTERVAL_MS,
  MOCK_POLL_INTERVAL_MS,
} from "./wan27-constants";

export type DashScopeRegion = "cn-beijing" | "ap-southeast-1";

export type VideoProviderRuntimeConfig = {
  providerId: VideoProviderId;
  allowPaidGeneration: boolean;
  dashscopeApiKey: string;
  dashscopeWorkspaceId: string;
  dashscopeRegion: DashScopeRegion;
  t2vModelId: string;
  r2vModelId: string;
  /** 后台「管理 API」video-shot HTTP 地址 */
  httpApiUrl?: string;
  /** 后台「管理 API」video-shot 密钥 */
  httpApiKey?: string;
  /** 后台「管理 API」video-shot 模型 / 方舟接入点 ID */
  httpModelId?: string;
};

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function parseDashScopeRegion(raw: string): DashScopeRegion {
  if (raw === "ap-southeast-1" || raw === "singapore") {
    return "ap-southeast-1";
  }
  return "cn-beijing";
}

function emptyHttpFields() {
  return { httpApiUrl: "", httpApiKey: "" };
}

/**
 * 仅读环境变量（同步）。测试与本机付费入口使用。
 * 画布普通生成请用 resolveVideoProviderRuntimeConfig（会读后台管理 API）。
 */
export function getVideoProviderRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): VideoProviderRuntimeConfig {
  const providerRaw = (env.VIDEO_PROVIDER ?? "mock").trim().toLowerCase();
  const providerId: VideoProviderId =
    providerRaw === "aliyun-wan27"
      ? "aliyun-wan27"
      : providerRaw === "http"
        ? "http"
        : "mock";

  return {
    providerId,
    allowPaidGeneration:
      (env.ALLOW_PAID_GENERATION ?? "false").trim().toLowerCase() === "true",
    dashscopeApiKey: (env.DASHSCOPE_API_KEY ?? "").trim(),
    dashscopeWorkspaceId: (env.DASHSCOPE_WORKSPACE_ID ?? "").trim(),
    dashscopeRegion: parseDashScopeRegion(
      env.DASHSCOPE_REGION ?? "cn-beijing",
    ),
    t2vModelId:
      (env.WAN_T2V_MODEL_ID ?? WAN27_DEFAULT_T2V_MODEL_ID).trim() ||
      WAN27_DEFAULT_T2V_MODEL_ID,
    r2vModelId:
      (env.WAN_R2V_MODEL_ID ?? WAN27_DEFAULT_R2V_MODEL_ID).trim() ||
      WAN27_DEFAULT_R2V_MODEL_ID,
    httpApiUrl: (env.VIDEO_SHOT_API_URL ?? "").trim(),
    httpApiKey: (
      env.ARK_API_KEY ??
      env.VOLC_API_KEY ??
      env.VIDEO_GEN_API_KEY ??
      env.CHARACTER_GEN_API_KEY ??
      env.OPENAI_API_KEY ??
      ""
    ).trim(),
    httpModelId: (
      env.VIDEO_SHOT_MODEL ??
      env.ARK_VIDEO_MODEL ??
      ""
    ).trim(),
  };
}

/**
 * 画布视频生成权威配置：优先后台「管理 API」绑定的视频模型。
 * - provider=http → HttpVideoProvider
 * - provider=mock → Mock（不再被 VIDEO_PROVIDER=aliyun 覆盖）
 */
export async function resolveVideoProviderRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
  options?: {
    getVideoShotConfig?: () => Promise<GenerationApiConfig>;
    /** 测试可强制读取后台配置；默认 Vitest 下只用环境变量，避免本机 data 污染 */
    preferAdminConfig?: boolean;
    /** When set, resolve via capability binding (no silent borrow). */
    capabilityId?:
      | "video.storyboard-shot.generate"
      | "video.storyboard-episode.generate"
      | "video.workflow-node.generate"
      | "video.personal.generate";
  },
): Promise<VideoProviderRuntimeConfig> {
  const envConfig = getVideoProviderRuntimeConfig(env);

  if (options?.capabilityId) {
    const { resolveAiCapabilityRuntimeConfig } = await import(
      "@/ai-config/resolve"
    );
    const resolved = await resolveAiCapabilityRuntimeConfig(
      options.capabilityId,
    );
    return runtimeFromShotConfig(envConfig, resolved.profile);
  }

  const underVitest = env.VITEST === "true" || process.env.VITEST === "true";
  if (underVitest && !options?.getVideoShotConfig && !options?.preferAdminConfig) {
    return envConfig;
  }

  const load =
    options?.getVideoShotConfig ??
    (() => getGenerationApiConfig("video-shot"));

  let shot: GenerationApiConfig;
  try {
    shot = await load();
  } catch {
    return envConfig;
  }

  return runtimeFromShotConfig(envConfig, shot);
}

function runtimeFromShotConfig(
  envConfig: VideoProviderRuntimeConfig,
  shot: GenerationApiConfig,
): VideoProviderRuntimeConfig {
  if (shot.enabled === false) {
    throw new Error("视频模型配置已禁用");
  }
  if (shot.provider === "http") {
    const apiUrl = normalizeGenerationApiUrl(shot.apiUrl);
    let modelId =
      (shot.model ?? "").trim() || (envConfig.httpModelId ?? "").trim();
    if (looksLikeArkVideoEndpoint(apiUrl)) {
      modelId = normalizeArkVideoModelId(modelId);
    } else if (isSd2HttpVideoDialect(apiUrl)) {
      modelId = normalizeSd2VideoModelId(modelId || DEFAULT_SD2_VIDEO_MODEL);
    }
    if (!modelId && looksLikeArkVideoEndpoint(apiUrl)) {
      modelId = DEFAULT_ARK_VIDEO_MODEL;
    }
    if (!modelId && isSd2HttpVideoDialect(apiUrl)) {
      modelId = DEFAULT_SD2_VIDEO_MODEL;
    }
    const rawKey = shot.apiKey.trim() || envConfig.httpApiKey || "";
    const httpApiKey = isPlausibleApiKey(rawKey) ? rawKey.trim() : "";
    return {
      ...envConfig,
      providerId: "http",
      allowPaidGeneration: false,
      t2vModelId: modelId || "http-video-t2v",
      r2vModelId: modelId || "http-video-r2v",
      httpApiUrl: apiUrl,
      httpApiKey,
      httpModelId: modelId,
    };
  }

  if (shot.provider === "aliyun-wan27") {
    const key =
      (isPlausibleApiKey(shot.apiKey) ? shot.apiKey.trim() : "") ||
      envConfig.dashscopeApiKey;
    return {
      ...envConfig,
      providerId: "aliyun-wan27",
      // Paid gate is env-only — admin binding cannot set allowPaidGeneration.
      allowPaidGeneration: envConfig.allowPaidGeneration,
      dashscopeApiKey: key,
      t2vModelId:
        (shot.model ?? "").trim() || envConfig.t2vModelId,
      r2vModelId:
        (shot.model ?? "").trim() || envConfig.r2vModelId,
      ...emptyHttpFields(),
    };
  }

  return {
    ...envConfig,
    providerId: "mock",
    allowPaidGeneration: false,
    t2vModelId: "mock-wan27-t2v",
    r2vModelId: "mock-wan27-r2v",
    ...emptyHttpFields(),
  };
}

/**
 * 北京：https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com
 * 新加坡：https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com
 */
export function buildDashScopeBaseUrl(params: {
  workspaceId: string;
  region: DashScopeRegion;
}): string {
  const workspaceId = params.workspaceId.trim();
  if (!workspaceId) {
    throw new Error("未配置 DASHSCOPE_WORKSPACE_ID，无法构造百炼 Endpoint");
  }
  if (params.region === "ap-southeast-1") {
    return `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com`;
  }
  return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com`;
}

export function assertAliyunConfigReady(
  config: VideoProviderRuntimeConfig,
): { ok: true } | { ok: false; code: string; message: string } {
  if (!config.dashscopeApiKey) {
    return {
      ok: false,
      code: "MISSING_DASHSCOPE_API_KEY",
      message: "未配置 DASHSCOPE_API_KEY，请在服务端环境变量中填写百炼 API Key",
    };
  }
  if (!config.dashscopeWorkspaceId) {
    return {
      ok: false,
      code: "MISSING_DASHSCOPE_WORKSPACE_ID",
      message:
        "未配置 DASHSCOPE_WORKSPACE_ID，请填写与 API Key 同一地域的业务空间 ID",
    };
  }
  return { ok: true };
}

export function assertHttpVideoConfigReady(
  config: VideoProviderRuntimeConfig,
): { ok: true } | { ok: false; code: string; message: string } {
  if (config.providerId !== "http") return { ok: true };
  if (!(config.httpApiUrl ?? "").trim()) {
    return {
      ok: false,
      code: "MISSING_HTTP_VIDEO_ENDPOINT",
      message: "未配置视频镜头 API 地址，请管理员在「系统管理 → API 接口」中填写",
    };
  }
  if (isInvalidGenerationApiUrl(config.httpApiUrl ?? "")) {
    return {
      ok: false,
      code: "INVALID_HTTP_VIDEO_ENDPOINT",
      message:
        "视频镜头 API 地址不能是控制台/登录页。请改为 https://ark.cn-beijing.volces.com/api/v3",
    };
  }
  // 方舟：只需有效 Base URL + API Key；模型可默认
  if (looksLikeArkVideoEndpoint(config.httpApiUrl ?? "")) {
    if (!isPlausibleApiKey(config.httpApiKey ?? "")) {
      return {
        ok: false,
        code: "MISSING_HTTP_VIDEO_API_KEY",
        message:
          "未配置有效的视频镜头 API Key（不要把接口地址填进密钥栏）。请管理员在「系统管理 → API 接口」中填写方舟 Key 并保存",
      };
    }
  }
  return { ok: true };
}

export function paidGenerationAllowed(
  config: VideoProviderRuntimeConfig,
  confirmPaidGeneration: boolean,
): { ok: true } | { ok: false; code: string; message: string } {
  if (config.providerId === "mock" || config.providerId === "http") {
    if (config.providerId === "http") {
      return assertHttpVideoConfigReady(config);
    }
    return { ok: true };
  }
  if (!config.allowPaidGeneration || !confirmPaidGeneration) {
    return {
      ok: false,
      code: "PAID_GENERATION_DISABLED",
      message:
        "真实付费生成当前未启用，请由管理员完成配置并手动确认。",
    };
  }
  return assertAliyunConfigReady(config);
}

export type PublicVideoConfig = {
  providerId: VideoProviderId;
  allowPaidGeneration: boolean;
  hasApiKey: boolean;
  hasWorkspaceId: boolean;
  /** HTTP 视频接口是否已配置地址 */
  hasEndpoint: boolean;
  region: DashScopeRegion;
  t2vModelId: string;
  r2vModelId: string;
  /** 客户端轮询间隔：真实 Provider 对齐官方约 15s；Mock/HTTP 可更快 */
  recommendedPollIntervalMs: number;
  costNotice: string;
  /**
   * 当前 HTTP 线路是否为移动 SD2（真人参考走认证上传，提交前不 omit 人物）。
   * 非 http / 非 SD2 时为 false。
   */
  usesSd2RealPersonCertification: boolean;
};

export function getPublicVideoConfigFromRuntime(
  config: VideoProviderRuntimeConfig,
): PublicVideoConfig {
  if (config.providerId === "http") {
    const modelId =
      (config.httpModelId ?? "").trim() ||
      config.t2vModelId ||
      "http-video-t2v";
    const httpUrl = (config.httpApiUrl ?? "").trim();
    return {
      providerId: "http",
      allowPaidGeneration: false,
      hasApiKey: Boolean(config.httpApiKey),
      hasWorkspaceId: true,
      hasEndpoint: Boolean(httpUrl),
      region: config.dashscopeRegion,
      t2vModelId: modelId,
      r2vModelId: modelId,
      recommendedPollIntervalMs: MOCK_POLL_INTERVAL_MS,
      costNotice: "费用以所配置的 HTTP 视频接口为准。",
      usesSd2RealPersonCertification: Boolean(
        httpUrl && isSd2HttpVideoDialect(httpUrl),
      ),
    };
  }

  if (config.providerId === "mock") {
    return {
      providerId: "mock",
      allowPaidGeneration: false,
      hasApiKey: false,
      hasWorkspaceId: false,
      hasEndpoint: true,
      region: config.dashscopeRegion,
      t2vModelId: config.t2vModelId,
      r2vModelId: config.r2vModelId,
      recommendedPollIntervalMs: MOCK_POLL_INTERVAL_MS,
      costNotice: "Mock 模式不计费。",
      usesSd2RealPersonCertification: false,
    };
  }

  return {
    providerId: config.providerId,
    allowPaidGeneration: config.allowPaidGeneration,
    hasApiKey: Boolean(config.dashscopeApiKey),
    hasWorkspaceId: Boolean(config.dashscopeWorkspaceId),
    hasEndpoint: true,
    region: config.dashscopeRegion,
    t2vModelId: config.t2vModelId,
    r2vModelId: config.r2vModelId,
    recommendedPollIntervalMs: WAN27_RECOMMENDED_POLL_INTERVAL_MS,
    costNotice:
      "预计费用请以阿里云百炼当前价格和控制台实际结算为准。",
    usesSd2RealPersonCertification: false,
  };
}

/** 供 UI 使用的公开配置（不含密钥）；仅环境变量，不含后台管理 API */
export function getPublicVideoConfig(
  env: Record<string, string | undefined> = process.env,
): PublicVideoConfig {
  return getPublicVideoConfigFromRuntime(getVideoProviderRuntimeConfig(env));
}

export async function resolvePublicVideoConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<PublicVideoConfig> {
  const runtime = await resolveVideoProviderRuntimeConfig(env);
  return getPublicVideoConfigFromRuntime(runtime);
}

export { readEnv };
