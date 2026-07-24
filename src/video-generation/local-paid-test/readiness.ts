import { LocalPaidTestError } from "./errors";
import type { LocalPaidTestEnvironmentReadiness } from "./types";
import type { VideoGenerationInput } from "../types";
import { collectLocalPaidTestSpecViolations } from "./spec";
import { assertValidConfirmationPhrase } from "./token";
import {
  assertLocalPaidTestEnvironmentAllowed,
  formatLocalDateYmd,
  getLocalPaidTestPublicConfig,
  getLocalPaidTestRuntimeConfig,
  isDevelopmentNodeEnv,
  isValidPriceConfirmedOn,
  validateMaxCostCny,
} from "./config";
import { getWanResultAllowedHosts } from "../secure-transfer/allowlist";

/**
 * 环境级 Readiness：不联网、不修改 Guard、不创建 generation。
 * 默认运行环境 readyForPaidSubmission / readyForOneShotLocalTest 均为 false。
 */
export function buildWan27LocalPaidTestEnvironmentReadiness(options: {
  env?: Record<string, string | undefined>;
  guardState: LocalPaidTestEnvironmentReadiness["guardState"];
  idempotencyStoreAvailable?: boolean;
  hasActiveGeneration?: boolean;
  /** 仅测试注入：允许在非默认配置下报告 one-shot ready */
  allowOneShotReadyIfConfigured?: boolean;
}): LocalPaidTestEnvironmentReadiness {
  const env = options.env ?? process.env;
  const cfg = getLocalPaidTestRuntimeConfig(env);
  const publicConfig = getLocalPaidTestPublicConfig(env);
  const checks: LocalPaidTestEnvironmentReadiness["checks"] = [];

  const isDev = isDevelopmentNodeEnv(env);
  checks.push({
    key: "node_env_development",
    status: isDev ? "pass" : "fail",
    message: isDev
      ? "NODE_ENV=development"
      : "非 development：一次性付费测试仅允许本机开发环境",
  });

  checks.push({
    key: "local_paid_test_mode",
    status: cfg.localPaidTestMode ? "pass" : "fail",
    message: cfg.localPaidTestMode
      ? "WAN_LOCAL_PAID_TEST_MODE=true"
      : "WAN_LOCAL_PAID_TEST_MODE 未开启（默认安全关闭）",
  });

  checks.push({
    key: "video_provider_aliyun",
    status: cfg.videoProvider.providerId === "aliyun-wan27" ? "pass" : "fail",
    message:
      cfg.videoProvider.providerId === "aliyun-wan27"
        ? "VIDEO_PROVIDER=aliyun-wan27"
        : "VIDEO_PROVIDER 仍为 mock（或非 aliyun）",
  });

  checks.push({
    key: "allow_paid_generation",
    status: cfg.videoProvider.allowPaidGeneration ? "pass" : "fail",
    message: cfg.videoProvider.allowPaidGeneration
      ? "ALLOW_PAID_GENERATION=true"
      : "ALLOW_PAID_GENERATION=false",
  });

  checks.push({
    key: "api_key",
    status: publicConfig.hasApiKey ? "pass" : "fail",
    message: publicConfig.hasApiKey
      ? "API Key 已配置（仅布尔）"
      : "API Key 未配置",
  });

  checks.push({
    key: "workspace",
    status: publicConfig.hasWorkspaceId ? "pass" : "fail",
    message: publicConfig.hasWorkspaceId
      ? "Workspace 已配置（仅布尔）"
      : "Workspace 未配置",
  });

  const regionOk =
    cfg.videoProvider.dashscopeRegion === "cn-beijing" ||
    cfg.videoProvider.dashscopeRegion === "ap-southeast-1";
  checks.push({
    key: "region",
    status: regionOk ? "pass" : "fail",
    message: regionOk ? `Region=${cfg.videoProvider.dashscopeRegion}` : "Region 无效",
  });

  checks.push({
    key: "t2v_model",
    status: Boolean(cfg.videoProvider.t2vModelId.trim()) ? "pass" : "fail",
    message: cfg.videoProvider.t2vModelId
      ? `T2V 模型已配置`
      : "T2V 模型缺失",
  });

  const idemOk = options.idempotencyStoreAvailable !== false;
  checks.push({
    key: "idempotency_store",
    status: idemOk ? "pass" : "fail",
    message: idemOk ? "持久幂等 Store 可用" : "幂等 Store 不可用",
  });

  checks.push({
    key: "ssrf_transfer",
    status: "pass",
    message: "SSRF 安全转存模块可用（allowlist 空时仍启用防护）",
  });

  checks.push({
    key: "token",
    status: publicConfig.tokenConfigured ? "pass" : "fail",
    message: publicConfig.tokenConfigured
      ? "测试 Token 已配置（是）"
      : "测试 Token 未配置（否）",
  });

  const today = formatLocalDateYmd();
  const priceOk = isValidPriceConfirmedOn(cfg.priceConfirmedOn, today);
  checks.push({
    key: "price_confirmed",
    status: priceOk ? "pass" : "fail",
    message: priceOk
      ? `当日价格已确认（${cfg.priceConfirmedOn}）`
      : "价格未确认或确认日期不是当天",
  });

  const maxOk = validateMaxCostCny(cfg.maxCostCny);
  checks.push({
    key: "max_cost",
    status: maxOk.ok ? "pass" : "fail",
    message: maxOk.ok
      ? `最大费用上限已确认：${maxOk.value} 元`
      : "最大费用无效或超出硬安全上限",
  });

  checks.push({
    key: "guard_armed",
    status: options.guardState === "armed" ? "pass" : "fail",
    message: `Guard 状态：${options.guardState}`,
  });

  const noActive = !options.hasActiveGeneration;
  checks.push({
    key: "no_active_generation",
    status: noActive ? "pass" : "fail",
    message: noActive ? "无 active generation" : "存在 active generation",
  });

  let allowlistConfigured = false;
  try {
    allowlistConfigured = getWanResultAllowedHosts(env).length > 0;
  } catch {
    allowlistConfigured = false;
  }
  checks.push({
    key: "result_allowlist",
    status: allowlistConfigured ? "pass" : "warning",
    message: allowlistConfigured
      ? "结果域名 allowlist 已配置（不返回完整列表）"
      : "allowlist 为空：可提交但转存会被阻止",
  });

  const criticalPass = checks
    .filter((c) => c.key !== "result_allowlist")
    .every((c) => c.status === "pass");

  // 默认实际环境：即使 criticalPass，本阶段也强制 readyForPaidSubmission=false
  // 仅当显式 allowOneShotReadyIfConfigured（测试注入）时 readyForOneShotLocalTest 可为 true
  const readyForOneShotLocalTest =
    options.allowOneShotReadyIfConfigured === true && criticalPass;

  return {
    readyForOneShotLocalTest,
    readyForPaidSubmission: false,
    readyForResultTransfer: allowlistConfigured,
    allowlistEmptyWarning: allowlistConfigured
      ? null
      : "生成任务可以提交，但结果转存会被阻止；需人工审批结果 hostname 后执行 retryTransfer。",
    checks,
    publicConfig,
    guardState: options.guardState,
  };
}

/**
 * 请求级校验：规格 + 确认短语 + confirmPaidGeneration。
 * 不调用网络，不修改 Guard。
 */
export function validateWan27OneShotPaidRequest(input: {
  generationInput: VideoGenerationInput;
  confirmPaidGeneration: boolean;
  confirmationPhrase: string;
  guardState: LocalPaidTestEnvironmentReadiness["guardState"];
  idempotencyKey?: string;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (!input.confirmPaidGeneration) {
    return {
      ok: false,
      code: "LOCAL_PAID_TEST_DISABLED",
      message: "未确认付费生成。",
    };
  }
  if (input.guardState !== "armed") {
    const err = new LocalPaidTestError(
      input.guardState === "unknownOutcome"
        ? "LOCAL_PAID_TEST_UNKNOWN_OUTCOME"
        : input.guardState === "unarmed" ||
            input.guardState === "failedBeforeSubmit"
          ? "LOCAL_PAID_TEST_NOT_ARMED"
          : "LOCAL_PAID_TEST_ALREADY_CONSUMED",
    );
    return { ok: false, code: err.code, message: err.message };
  }
  try {
    assertValidConfirmationPhrase(input.confirmationPhrase);
  } catch (e) {
    if (e instanceof LocalPaidTestError) {
      return { ok: false, code: e.code, message: e.message };
    }
    throw e;
  }
  const violations = collectLocalPaidTestSpecViolations(input.generationInput);
  if (violations.length > 0) {
    const err = new LocalPaidTestError("LOCAL_PAID_TEST_SPEC_NOT_ALLOWED");
    return { ok: false, code: err.code, message: err.message };
  }
  if (input.idempotencyKey !== undefined && !input.idempotencyKey.trim()) {
    return {
      ok: false,
      code: "LOCAL_PAID_TEST_DISABLED",
      message: "幂等键无效。",
    };
  }
  return { ok: true };
}

export function assertCanUseLocalPaidTestGate(
  env: Record<string, string | undefined> = process.env,
): void {
  assertLocalPaidTestEnvironmentAllowed(env);
  const cfg = getLocalPaidTestRuntimeConfig(env);
  if (!cfg.localPaidTestMode) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_DISABLED");
  }
}
