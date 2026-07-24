import type { VideoProviderId } from "../types";
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

export function getVideoProviderRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): VideoProviderRuntimeConfig {
  const providerRaw = (env.VIDEO_PROVIDER ?? "mock").trim().toLowerCase();
  const providerId: VideoProviderId =
    providerRaw === "aliyun-wan27" ? "aliyun-wan27" : "mock";

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

export function paidGenerationAllowed(
  config: VideoProviderRuntimeConfig,
  confirmPaidGeneration: boolean,
): { ok: true } | { ok: false; code: string; message: string } {
  if (config.providerId !== "aliyun-wan27") {
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

/** 供 UI 使用的公开配置（不含密钥） */
export function getPublicVideoConfig(
  env: Record<string, string | undefined> = process.env,
): {
  providerId: VideoProviderId;
  allowPaidGeneration: boolean;
  hasApiKey: boolean;
  hasWorkspaceId: boolean;
  region: DashScopeRegion;
  t2vModelId: string;
  r2vModelId: string;
  /** 客户端轮询间隔：真实 Provider 对齐官方约 15s；Mock 可更快 */
  recommendedPollIntervalMs: number;
  costNotice: string;
} {
  const config = getVideoProviderRuntimeConfig(env);
  return {
    providerId: config.providerId,
    allowPaidGeneration: config.allowPaidGeneration,
    hasApiKey: Boolean(config.dashscopeApiKey),
    hasWorkspaceId: Boolean(config.dashscopeWorkspaceId),
    region: config.dashscopeRegion,
    t2vModelId: config.t2vModelId,
    r2vModelId: config.r2vModelId,
    recommendedPollIntervalMs:
      config.providerId === "aliyun-wan27"
        ? WAN27_RECOMMENDED_POLL_INTERVAL_MS
        : MOCK_POLL_INTERVAL_MS,
    costNotice:
      "预计费用请以阿里云百炼当前价格和控制台实际结算为准。",
  };
}

export { readEnv };
