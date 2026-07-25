import { NextResponse } from "next/server";
import { requireAdminUser } from "@/auth/require-user";
import {
  FileWanLocalPaidTestGuardStore,
  buildWan27LocalPaidTestEnvironmentReadiness,
  getLocalPaidTestPublicConfig,
  isDevelopmentNodeEnv,
  LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
  LOCAL_PAID_TEST_SPEC,
} from "@/video-generation/local-paid-test";

function getLiveStore() {
  return new FileWanLocalPaidTestGuardStore({ namespace: "live" });
}

export async function GET() {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  const env = process.env;
  const publicConfig = getLocalPaidTestPublicConfig(env);
  // 非 development 或不开启模式：只返回安全布尔，不暴露内部细节过多
  if (!isDevelopmentNodeEnv(env) || !publicConfig.localPaidTestModeEnabled) {
    return NextResponse.json({
      visible: false,
      publicConfig: {
        localPaidTestModeEnabled: publicConfig.localPaidTestModeEnabled,
        isDevelopment: publicConfig.isDevelopment,
        tokenConfigured: publicConfig.tokenConfigured,
        priceConfirmed: publicConfig.priceConfirmed,
        maxCostConfigured: publicConfig.maxCostConfigured,
        allowlistConfigured: publicConfig.allowlistConfigured,
        realSubmitEnabled: false,
        realSubmitPathWired: true,
        phaseNotice: publicConfig.phaseNotice,
      },
      confirmationPhraseHint: null,
      fixedSpec: LOCAL_PAID_TEST_SPEC,
    });
  }

  const store = getLiveStore();
  const guard = await store.get();
  const readiness = buildWan27LocalPaidTestEnvironmentReadiness({
    env,
    guardState: guard.state,
  });

  return NextResponse.json({
    visible: true,
    publicConfig,
    confirmationPhraseHint: LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
    fixedSpec: LOCAL_PAID_TEST_SPEC,
    guard: {
      state: guard.state,
      generationId: guard.generationId,
      hasProviderTaskId: Boolean(guard.providerTaskId),
      armedAt: guard.armedAt,
      updatedAt: guard.updatedAt,
      lastErrorCode: guard.lastErrorCode,
      simulation: guard.simulation,
    },
    readiness: {
      readyForOneShotLocalTest: readiness.readyForOneShotLocalTest,
      readyForPaidSubmission: readiness.readyForPaidSubmission,
      readyForResultTransfer: readiness.readyForResultTransfer,
      allowlistEmptyWarning: readiness.allowlistEmptyWarning,
      checks: readiness.checks,
    },
  });
}

// POST 保留空：Arm / Simulation 走子路径，避免误触
export async function POST() {
  return NextResponse.json(
    { code: "METHOD_NOT_ALLOWED", message: "请使用 /arm、/simulation 或 /submit 子路径。" },
    { status: 405 },
  );
}
