import {
  buildDashScopeBaseUrl,
  getVideoProviderRuntimeConfig,
  type VideoProviderRuntimeConfig,
} from "./config";
import {
  WAN27_DEFAULT_R2V_MODEL_ID,
  WAN27_DEFAULT_T2V_MODEL_ID,
  WAN27_UI_COST_NOTICE,
} from "./wan27-constants";
import { getWanResultAllowedHosts } from "../secure-transfer/allowlist";

export type ReadinessCheckStatus = "pass" | "fail" | "warning";

export type Wan27ReadinessCheck = {
  key: string;
  status: ReadinessCheckStatus;
  message: string;
};

export type Wan27ProviderReadinessReport = {
  readyForDryRun: boolean;
  /** 本阶段硬性要求：始终为 false，不自动开放付费 */
  readyForPaidSubmission: boolean;
  readyForResultTransfer: boolean;
  costNotice: string;
  checks: Wan27ReadinessCheck[];
};

function maskWorkspaceId(workspaceId: string): string {
  const id = workspaceId.trim();
  if (!id) return "missing";
  if (id.length <= 6) return `${id[0] ?? "*"}***`;
  return `${id.slice(0, 3)}…${id.slice(-2)}`;
}

function endpointHostnameOrError(config: VideoProviderRuntimeConfig): {
  ok: boolean;
  hostname?: string;
  error?: string;
} {
  if (!config.dashscopeWorkspaceId.trim()) {
    return { ok: false, error: "缺少 Workspace ID，无法构造 Endpoint" };
  }
  try {
    const base = buildDashScopeBaseUrl({
      workspaceId: config.dashscopeWorkspaceId,
      region: config.dashscopeRegion,
    });
    const hostname = new URL(base).hostname;
    // 脱敏：不返回完整 Workspace 前缀明文之外的片段已在 hostname 中；
    // 报告只暴露地域后缀形态，避免完整 Workspace 泄露
    const parts = hostname.split(".");
    const masked =
      parts.length >= 3
        ? `${maskWorkspaceId(config.dashscopeWorkspaceId)}.${parts.slice(1).join(".")}`
        : hostname;
    return { ok: true, hostname: masked };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Endpoint 构造失败",
    };
  }
}

/**
 * 纯函数：不联网、不创建任务、不修改环境变量。
 * readyForPaidSubmission 在本阶段始终为 false。
 */
export function buildWan27ProviderReadinessReport(
  env: Record<string, string | undefined> = process.env,
  options?: {
    /** 人工确认当日价格后可传 true；仍不会使 readyForPaidSubmission 为 true（本阶段硬门闩） */
    priceManuallyConfirmed?: boolean;
    idempotencyStoreAvailable?: boolean;
  },
): Wan27ProviderReadinessReport {
  const config = getVideoProviderRuntimeConfig(env);
  const checks: Wan27ReadinessCheck[] = [];

  const stillMock = config.providerId === "mock";
  checks.push({
    key: "video_provider_mock",
    status: stillMock ? "pass" : "warning",
    message: stillMock
      ? "当前 VIDEO_PROVIDER 仍为 mock（安全默认）"
      : "当前 VIDEO_PROVIDER 已切到 aliyun-wan27（仍须人工付费门闩）",
  });

  const paidOff = !config.allowPaidGeneration;
  checks.push({
    key: "allow_paid_generation_off",
    status: paidOff ? "pass" : "fail",
    message: paidOff
      ? "ALLOW_PAID_GENERATION 仍为 false"
      : "ALLOW_PAID_GENERATION 为 true（本阶段仍禁止自动付费提交）",
  });

  checks.push({
    key: "api_key_present",
    status: config.dashscopeApiKey ? "pass" : "warning",
    message: config.dashscopeApiKey
      ? "DASHSCOPE_API_KEY 已配置（仅布尔，不返回密钥）"
      : "DASHSCOPE_API_KEY 未配置",
  });

  checks.push({
    key: "workspace_id_present",
    status: config.dashscopeWorkspaceId ? "pass" : "warning",
    message: config.dashscopeWorkspaceId
      ? `DASHSCOPE_WORKSPACE_ID 已配置（脱敏：${maskWorkspaceId(config.dashscopeWorkspaceId)}）`
      : "DASHSCOPE_WORKSPACE_ID 未配置",
  });

  const regionOk =
    config.dashscopeRegion === "cn-beijing" ||
    config.dashscopeRegion === "ap-southeast-1";
  checks.push({
    key: "region_supported",
    status: regionOk ? "pass" : "fail",
    message: regionOk
      ? `地域受支持：${config.dashscopeRegion}`
      : `地域不受支持：${config.dashscopeRegion}`,
  });

  const endpoint = endpointHostnameOrError(config);
  checks.push({
    key: "endpoint_buildable",
    status: endpoint.ok ? "pass" : "fail",
    message: endpoint.ok
      ? `Endpoint 可安全构建（hostname 脱敏：${endpoint.hostname}）`
      : endpoint.error ?? "Endpoint 无法构建",
  });

  const t2vOk = Boolean(config.t2vModelId.trim());
  checks.push({
    key: "t2v_model_id",
    status: t2vOk ? "pass" : "fail",
    message: t2vOk
      ? `T2V 模型 ID 存在：${config.t2vModelId || WAN27_DEFAULT_T2V_MODEL_ID}`
      : "T2V 模型 ID 缺失",
  });

  const r2vOk = Boolean(config.r2vModelId.trim());
  checks.push({
    key: "r2v_model_id",
    status: r2vOk ? "pass" : "fail",
    message: r2vOk
      ? `R2V 模型 ID 存在：${config.r2vModelId || WAN27_DEFAULT_R2V_MODEL_ID}`
      : "R2V 模型 ID 缺失",
  });

  let allowlistConfigured = false;
  try {
    const rules = getWanResultAllowedHosts(env);
    allowlistConfigured = rules.length > 0;
    checks.push({
      key: "result_allowlist",
      status: allowlistConfigured ? "pass" : "warning",
      message: allowlistConfigured
        ? `WAN_RESULT_ALLOWED_HOSTS 已配置（规则数 ${rules.length}，不返回完整列表）`
        : "WAN_RESULT_ALLOWED_HOSTS 为空：真实结果转存仍被禁用",
    });
  } catch {
    checks.push({
      key: "result_allowlist",
      status: "fail",
      message: "WAN_RESULT_ALLOWED_HOSTS 配置无效",
    });
  }

  const idempotencyOk = options?.idempotencyStoreAvailable !== false;
  checks.push({
    key: "idempotency_store",
    status: idempotencyOk ? "pass" : "fail",
    message: idempotencyOk
      ? "持久幂等 Store 按本地文件 backend 可用（单机）"
      : "持久幂等 Store 不可用",
  });

  checks.push({
    key: "ssrf_transfer",
    status: "pass",
    message: "SSRF 安全转存已启用（真实结果须 allowlist + HTTPS）",
  });

  checks.push({
    key: "ownership_rate_limit_budget",
    status: "warning",
    message:
      "用户所有权、服务端限流、预算、数据库与对象存储仍未完成",
  });

  checks.push({
    key: "single_user_local_only",
    status: "pass",
    message: "当前环境仅适合本机单用户测试，不适合多实例生产",
  });

  const priceConfirmed = options?.priceManuallyConfirmed === true;
  checks.push({
    key: "price_manual_confirmation",
    status: priceConfirmed ? "pass" : "warning",
    message: priceConfirmed
      ? "已标记人工确认当日价格（仍不自动开放付费）"
      : "费用待人工确认：请查看官方「模型价格」页与控制台结算",
  });

  checks.push({
    key: "phase_paid_gate",
    status: "fail",
    message:
      "阶段 3D-B6-A：readyForPaidSubmission 硬性保持 false，禁止自动付费",
  });

  const readyForDryRun =
    regionOk &&
    t2vOk &&
    r2vOk &&
    (endpoint.ok || !config.dashscopeWorkspaceId) &&
    idempotencyOk;

  const readyForResultTransfer = allowlistConfigured;

  return {
    readyForDryRun,
    readyForPaidSubmission: false,
    readyForResultTransfer,
    costNotice: WAN27_UI_COST_NOTICE,
    checks,
  };
}
