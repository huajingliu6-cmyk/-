import { createHash } from "crypto";
import {
  buildWan27Request,
  type Wan27RequestBody,
} from "../build-wan27-request";
import { resolveOutputDimensions } from "../dimensions";
import {
  getAliyunWan27Capabilities,
  pickCapability,
} from "../model-capabilities";
import { selectWanGenerationMode } from "../select-wan-mode";
import type {
  ProviderGenerationInput,
  VideoAspectRatio,
  VideoGenerationInput,
} from "../types";
import {
  buildDashScopeBaseUrl,
  getVideoProviderRuntimeConfig,
  type DashScopeRegion,
  type VideoProviderRuntimeConfig,
} from "./config";
import {
  WAN27_CREATE_PATH,
  WAN27_UI_COST_NOTICE,
} from "./wan27-constants";
import { getWanResultAllowedHosts } from "../secure-transfer/allowlist";

export type Wan27DryRunPreview = {
  provider: "aliyun-wan27";
  region: DashScopeRegion;
  /** 仅 hostname，Workspace 已脱敏 */
  endpointHostname: string;
  createPath: string;
  modelId: string;
  mode: "T2V" | "R2V";
  resolution: string;
  aspectRatio: string | null;
  durationSeconds: number;
  estimatedWidth: number | null;
  estimatedHeight: number | null;
  promptCharCount: number;
  /** 短摘要或哈希，绝非完整 prompt */
  promptSafeDigest: string;
  referenceImageCount: number;
  referenceVideoCount: number;
  hasFirstFrame: boolean;
  hasAudio: boolean;
  promptExtend: boolean;
  watermark: boolean;
  mayIncurCost: boolean;
  paidSubmissionAllowed: boolean;
  allowlistPrepared: boolean;
  costStatus: "费用待人工确认" | "预计费用请以控制台为准";
  costNotice: string;
  /** 固定安全提示：Dry Run 永不发真实请求 */
  noRealRequestNotice: "当前不会发送真实请求，也不会产生费用。";
  blockers: string[];
  headersPreview: {
    hasAuthorizationPlaceholder: boolean;
    contentType: "application/json";
    xDashScopeAsync: "enable";
  };
  /** 证明未包含敏感原文 */
  redaction: {
    includesFullPrompt: false;
    includesBase64: false;
    includesSignedUrl: false;
    includesApiKey: false;
  };
};

function maskHostname(workspaceId: string, region: DashScopeRegion): string {
  const id = workspaceId.trim();
  const masked =
    id.length <= 6
      ? `${id[0] ?? "x"}***`
      : `${id.slice(0, 3)}…${id.slice(-2)}`;
  if (region === "ap-southeast-1") {
    return `${masked}.ap-southeast-1.maas.aliyuncs.com`;
  }
  return `${masked}.cn-beijing.maas.aliyuncs.com`;
}

function promptDigest(prompt: string): string {
  const hash = createHash("sha256").update(prompt, "utf8").digest("hex");
  return `sha256:${hash.slice(0, 12)}…`;
}

function countMedia(body: Wan27RequestBody): {
  images: number;
  videos: number;
  firstFrame: boolean;
  audio: boolean;
} {
  const media = body.input.media ?? [];
  return {
    images: media.filter((m) => m.type === "reference_image").length,
    videos: media.filter((m) => m.type === "reference_video").length,
    firstFrame: media.some((m) => m.type === "first_frame"),
    audio: media.some((m) => Boolean(m.reference_voice)),
  };
}

/**
 * 仅构建脱敏请求摘要：不调用 fetch、不创建 GenerationRecord / 幂等记录、不产生费用。
 */
export function buildWan27DryRunPreview(params: {
  input: VideoGenerationInput;
  resolvedMedia?: ProviderGenerationInput["resolvedMedia"];
  env?: Record<string, string | undefined>;
  config?: VideoProviderRuntimeConfig;
}): Wan27DryRunPreview {
  const env = params.env ?? process.env;
  const config = params.config ?? getVideoProviderRuntimeConfig(env);
  const mode = selectWanGenerationMode(params.input);
  const capabilities = getAliyunWan27Capabilities({
    t2vModelId: config.t2vModelId,
    r2vModelId: config.r2vModelId,
  });
  const capability = pickCapability(capabilities, mode);
  const resolvedMedia = params.resolvedMedia ?? [];
  const body = buildWan27Request(params.input, capability, resolvedMedia);
  const mediaCounts = countMedia(body);

  const blockers: string[] = [];
  if (config.providerId !== "aliyun-wan27") {
    blockers.push("当前 VIDEO_PROVIDER 仍为 mock，不会发起真实请求");
  }
  if (!config.allowPaidGeneration) {
    blockers.push("ALLOW_PAID_GENERATION=false，禁止付费提交");
  }
  if (!config.dashscopeApiKey) {
    blockers.push("缺少 DASHSCOPE_API_KEY");
  }
  if (!config.dashscopeWorkspaceId) {
    blockers.push("缺少 DASHSCOPE_WORKSPACE_ID");
  }
  if (!config.t2vModelId.trim()) {
    blockers.push("缺少 T2V 模型 ID");
  }
  if (!config.r2vModelId.trim()) {
    blockers.push("缺少 R2V 模型 ID");
  }

  let allowlistPrepared = false;
  try {
    allowlistPrepared = getWanResultAllowedHosts(env).length > 0;
  } catch {
    allowlistPrepared = false;
    blockers.push("WAN_RESULT_ALLOWED_HOSTS 配置无效");
  }
  if (!allowlistPrepared) {
    blockers.push("结果域名 allowlist 未配置，成功后转存会被阻止");
  }

  blockers.push("阶段门闩：readyForPaidSubmission=false，本阶段禁止真实付费");
  blockers.push("费用待人工确认");

  let endpointHostname = "(未配置 Workspace)";
  if (config.dashscopeWorkspaceId.trim()) {
    try {
      // 验证可构建，但报告使用脱敏 hostname
      buildDashScopeBaseUrl({
        workspaceId: config.dashscopeWorkspaceId,
        region: config.dashscopeRegion,
      });
      endpointHostname = maskHostname(
        config.dashscopeWorkspaceId,
        config.dashscopeRegion,
      );
    } catch {
      blockers.push("Endpoint 无法安全构建");
      endpointHostname = "(构建失败)";
    }
  }

  const ratio = body.parameters.ratio ?? null;
  let estimatedWidth: number | null = null;
  let estimatedHeight: number | null = null;
  if (
    ratio &&
    (body.parameters.resolution === "480P" ||
      body.parameters.resolution === "720P" ||
      body.parameters.resolution === "1080P")
  ) {
    const dims = resolveOutputDimensions(
      body.parameters.resolution,
      ratio as VideoAspectRatio,
    );
    estimatedWidth = dims.width;
    estimatedHeight = dims.height;
  }

  const mayIncurCost =
    config.providerId === "aliyun-wan27" && config.allowPaidGeneration;

  return {
    provider: "aliyun-wan27",
    region: config.dashscopeRegion,
    endpointHostname,
    createPath: WAN27_CREATE_PATH,
    modelId: body.model,
    mode: mode === "textToVideo" ? "T2V" : "R2V",
    resolution: body.parameters.resolution,
    aspectRatio: ratio,
    durationSeconds: body.parameters.duration,
    estimatedWidth,
    estimatedHeight,
    promptCharCount: body.input.prompt.length,
    promptSafeDigest: promptDigest(body.input.prompt),
    referenceImageCount: mediaCounts.images,
    referenceVideoCount: mediaCounts.videos,
    hasFirstFrame: mediaCounts.firstFrame,
    hasAudio: mediaCounts.audio,
    promptExtend: body.parameters.prompt_extend,
    watermark: body.parameters.watermark,
    mayIncurCost,
    paidSubmissionAllowed: false,
    allowlistPrepared,
    costStatus: "费用待人工确认",
    costNotice: WAN27_UI_COST_NOTICE,
    noRealRequestNotice: "当前不会发送真实请求，也不会产生费用。",
    blockers,
    headersPreview: {
      hasAuthorizationPlaceholder: true,
      contentType: "application/json",
      xDashScopeAsync: "enable",
    },
    redaction: {
      includesFullPrompt: false,
      includesBase64: false,
      includesSignedUrl: false,
      includesApiKey: false,
    },
  };
}
