import {
  getVideoProviderRuntimeConfig,
  type VideoProviderRuntimeConfig,
} from "../provider/config";
import {
  LOCAL_PAID_TEST_COST_NOTICE,
  LOCAL_PAID_TEST_HARD_MAX_COST_CNY,
  LOCAL_PAID_TEST_MAX_TASKS,
  LOCAL_PAID_TEST_PHASE_NOTICE,
} from "./constants";

import { LocalPaidTestError } from "./errors";
import type { LocalPaidTestPublicConfig } from "./types";

export type LocalPaidTestRuntimeConfig = {
  localPaidTestMode: boolean;
  token: string;
  priceConfirmedOn: string;
  maxCostCny: number | null;
  maxTasks: number;
  nodeEnv: string;
  videoProvider: VideoProviderRuntimeConfig;
};

function readEnv(
  env: Record<string, string | undefined>,
  name: string,
): string {
  return env[name]?.trim() ?? "";
}

export function getNodeEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  return (env.NODE_ENV ?? "development").trim().toLowerCase();
}

export function isDevelopmentNodeEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getNodeEnv(env) === "development";
}

export function isProductionNodeEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getNodeEnv(env) === "production";
}

export function getLocalPaidTestRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): LocalPaidTestRuntimeConfig {
  const maxRaw = readEnv(env, "WAN_TEST_MAX_COST_CNY");
  let maxCostCny: number | null = null;
  if (maxRaw) {
    const n = Number(maxRaw);
    if (Number.isFinite(n)) maxCostCny = n;
  }

  const maxTasksRaw = readEnv(env, "WAN_TEST_MAX_TASKS");
  const maxTasksParsed = maxTasksRaw
    ? Number(maxTasksRaw)
    : LOCAL_PAID_TEST_MAX_TASKS;
  const maxTasks =
    Number.isFinite(maxTasksParsed) && maxTasksParsed === 1
      ? 1
      : LOCAL_PAID_TEST_MAX_TASKS;

  return {
    localPaidTestMode:
      readEnv(env, "WAN_LOCAL_PAID_TEST_MODE").toLowerCase() === "true",
    token: readEnv(env, "WAN_LOCAL_PAID_TEST_TOKEN"),
    priceConfirmedOn: readEnv(env, "WAN_TEST_PRICE_CONFIRMED_ON"),
    maxCostCny,
    maxTasks,
    nodeEnv: getNodeEnv(env),
    videoProvider: getVideoProviderRuntimeConfig(env),
  };
}

/** YYYY-MM-DD in local timezone */
export function formatLocalDateYmd(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isValidPriceConfirmedOn(
  value: string,
  today: string = formatLocalDateYmd(),
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value === today;
}

export function validateMaxCostCny(
  value: number | null,
):
  | { ok: true; value: number }
  | { ok: false; code: "LOCAL_PAID_TEST_MAX_COST_INVALID" } {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return { ok: false, code: "LOCAL_PAID_TEST_MAX_COST_INVALID" };
  }
  if (value > LOCAL_PAID_TEST_HARD_MAX_COST_CNY) {
    return { ok: false, code: "LOCAL_PAID_TEST_MAX_COST_INVALID" };
  }
  return { ok: true, value };
}

/**
 * 生产永远拒绝；仅 development 允许本机测试闸门。
 * test 环境只能走 Simulation，不能开启真实联网闸门。
 */
export function assertLocalPaidTestEnvironmentAllowed(
  env: Record<string, string | undefined> = process.env,
): void {
  if (isProductionNodeEnv(env) || !isDevelopmentNodeEnv(env)) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_NOT_ALLOWED_IN_PRODUCTION");
  }
}

export function getLocalPaidTestPublicConfig(
  env: Record<string, string | undefined> = process.env,
): LocalPaidTestPublicConfig {
  const cfg = getLocalPaidTestRuntimeConfig(env);
  const today = formatLocalDateYmd();
  const priceOk = isValidPriceConfirmedOn(cfg.priceConfirmedOn, today);
  const maxOk = validateMaxCostCny(cfg.maxCostCny);
  const allowlistConfigured = Boolean(
    (env.WAN_RESULT_ALLOWED_HOSTS ?? "").trim(),
  );

  return {
    localPaidTestModeEnabled: cfg.localPaidTestMode,
    isDevelopment: isDevelopmentNodeEnv(env),
    tokenConfigured: Boolean(cfg.token),
    priceConfirmed: priceOk,
    priceConfirmedOn: cfg.priceConfirmedOn || null,
    maxCostConfigured: maxOk.ok,
    maxCostCny: maxOk.ok ? maxOk.value : null,
    maxTasks: cfg.maxTasks,
    providerIsAliyun: cfg.videoProvider.providerId === "aliyun-wan27",
    allowPaidGeneration: cfg.videoProvider.allowPaidGeneration,
    hasApiKey: Boolean(cfg.videoProvider.dashscopeApiKey),
    hasWorkspaceId: Boolean(cfg.videoProvider.dashscopeWorkspaceId),
    region: cfg.videoProvider.dashscopeRegion,
    t2vModelId: cfg.videoProvider.t2vModelId,
    allowlistConfigured,
    hardMaxCostCny: LOCAL_PAID_TEST_HARD_MAX_COST_CNY,
    confirmationPhraseRequired: true,
    costNotice: LOCAL_PAID_TEST_COST_NOTICE,
    phaseNotice: LOCAL_PAID_TEST_PHASE_NOTICE,
    realSubmitPathWired: true,
    // 默认环境仍不可真实提交；由 readiness / 专用 API 门闩决定
    realSubmitEnabled: false,
  };
}
