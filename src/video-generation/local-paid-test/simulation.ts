import { randomUUID } from "crypto";
import type { VideoGenerationInput } from "../types";
import { FileWanLocalPaidTestGuardStore } from "./guard-store";
import { assertLocalPaidTestSpec } from "./spec";
import { LocalPaidTestError } from "./errors";
import type { LocalPaidTestGuardState, WanLocalPaidTestGuardRecord } from "./types";

export type LocalPaidTestSimulationStep =
  | "unarmed_reject"
  | "arm"
  | "readiness_pass"
  | "submitting"
  | "providerAccepted"
  | "transferPending"
  | "completed"
  | "failedBeforeSubmit"
  | "unknownOutcome"
  | "consumed"
  | "duplicate_submit_blocked"
  | "retry_generation_blocked"
  | "retry_transfer_allowed";

export type LocalPaidTestSimulationResult = {
  simulation: true;
  fakeProviderTaskId: string;
  steps: Array<{
    step: LocalPaidTestSimulationStep;
    ok: boolean;
    guardState: LocalPaidTestGuardState;
    detail: string;
  }>;
  finalGuard: WanLocalPaidTestGuardRecord;
  createdFormalGeneration: false;
  createdFormalIdempotency: false;
  createdFormalVideoAsset: false;
  calledNetwork: false;
};

function baseSimInput(): VideoGenerationInput {
  return {
    shotId: "sim-shot",
    projectId: "sim-project",
    prompt: "simulation-only-prompt-not-persisted",
    resolution: "720P",
    aspectRatio: "16:9",
    durationSeconds: 2,
    watermark: false,
    promptExtend: false,
    characterReferences: [],
    sceneReferences: [],
    imageReferences: [],
    referenceVideos: [],
    orderedReferenceMedia: [],
    textInputs: [],
    referenceSelectionMode: "auto",
    selectedReferenceAssetIds: [],
  };
}

/**
 * 零费用 Simulation：假 Provider、隔离 Guard 目录、不写正式 generation/幂等/视频。
 * 永不访问互联网。
 */
export async function runLocalPaidTestSimulation(options: {
  rootDir: string;
  scenario?: "happy-path" | "unknown-outcome" | "failed-before-submit";
}): Promise<LocalPaidTestSimulationResult> {
  const store = new FileWanLocalPaidTestGuardStore({
    rootDir: options.rootDir,
    namespace: "simulation",
  });
  const steps: LocalPaidTestSimulationResult["steps"] = [];
  const fakeProviderTaskId = `sim-fake-task-${randomUUID()}`;
  const scenario = options.scenario ?? "happy-path";

  const push = (
    step: LocalPaidTestSimulationStep,
    ok: boolean,
    guard: WanLocalPaidTestGuardRecord,
    detail: string,
  ) => {
    steps.push({ step, ok, guardState: guard.state, detail });
  };

  // 1) unarmed 拒绝提交
  let guard = await store.get();
  try {
    await store.markSubmitting({ generationId: "should-fail" });
    push("unarmed_reject", false, await store.get(), "expected reject");
  } catch (err) {
    guard = await store.get();
    push(
      "unarmed_reject",
      err instanceof LocalPaidTestError &&
        err.code === "LOCAL_PAID_TEST_NOT_ARMED",
      guard,
      "unarmed 拒绝提交",
    );
  }

  // 2) arm
  guard = await store.arm({});
  push("arm", guard.state === "armed", guard, "Guard → armed");

  // 3) readiness_pass（规格）
  try {
    assertLocalPaidTestSpec(baseSimInput());
    push("readiness_pass", true, guard, "最低规格校验通过");
  } catch {
    push("readiness_pass", false, guard, "规格校验失败");
  }

  if (scenario === "failed-before-submit") {
    guard = await store.markFailedBeforeSubmit({
      errorCode: "SIM_FAILED_BEFORE_SUBMIT",
    });
    push(
      "failedBeforeSubmit",
      guard.state === "failedBeforeSubmit",
      guard,
      "确认 Provider 未接单 → failedBeforeSubmit",
    );
    // 可重新 arm
    guard = await store.arm({});
    push("arm", guard.state === "armed", guard, "failedBeforeSubmit 后重新 arm");
  }

  // 4) submitting
  const simGenerationId = `sim-gen-${randomUUID()}`;
  guard = await store.markSubmitting({ generationId: simGenerationId });
  push("submitting", guard.state === "submitting", guard, "Guard → submitting");

  // 5) 第二次提交阻止
  try {
    await store.markSubmitting({ generationId: "second" });
    push("duplicate_submit_blocked", false, await store.get(), "应阻止");
  } catch (err) {
    push(
      "duplicate_submit_blocked",
      err instanceof LocalPaidTestError,
      await store.get(),
      "第二次提交已阻止",
    );
  }

  if (scenario === "unknown-outcome") {
    guard = await store.markUnknownOutcome({
      generationId: simGenerationId,
      errorCode: "SIM_UNKNOWN",
    });
    push(
      "unknownOutcome",
      guard.state === "unknownOutcome",
      guard,
      "提交结果无法确认，一次性测试已锁定",
    );
    try {
      await store.markSubmitting({ generationId: "again" });
      push("duplicate_submit_blocked", false, await store.get(), "unknown 应阻止");
    } catch (err) {
      push(
        "duplicate_submit_blocked",
        err instanceof LocalPaidTestError &&
          err.code === "LOCAL_PAID_TEST_UNKNOWN_OUTCOME",
        await store.get(),
        "unknownOutcome 阻止再次提交",
      );
    }
    return {
      simulation: true,
      fakeProviderTaskId,
      steps,
      finalGuard: await store.get(),
      createdFormalGeneration: false,
      createdFormalIdempotency: false,
      createdFormalVideoAsset: false,
      calledNetwork: false,
    };
  }

  // 6) providerAccepted（假 task id）
  guard = await store.markProviderAccepted({
    generationId: simGenerationId,
    providerTaskId: fakeProviderTaskId,
  });
  push(
    "providerAccepted",
    guard.state === "providerAccepted" &&
      guard.providerTaskId === fakeProviderTaskId,
    guard,
    "假 Provider 接单（非真实网络）",
  );

  // 7) retryGeneration 阻止语义
  try {
    if (
      guard.state === "providerAccepted" ||
      guard.state === "transferPending" ||
      guard.state === "completed" ||
      guard.state === "consumed" ||
      guard.state === "unknownOutcome" ||
      guard.state === "submitting"
    ) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_ALREADY_CONSUMED");
    }
    push("retry_generation_blocked", false, guard, "应阻止");
  } catch (err) {
    push(
      "retry_generation_blocked",
      err instanceof LocalPaidTestError &&
        err.code === "LOCAL_PAID_TEST_ALREADY_CONSUMED",
      await store.get(),
      "retryGeneration 在一次性模式中禁止",
    );
  }

  // 8) transferPending + retryTransfer 允许（不消耗第二名额）
  guard = await store.markTransferPending({
    generationId: simGenerationId,
    providerTaskId: fakeProviderTaskId,
  });
  push(
    "transferPending",
    guard.state === "transferPending",
    guard,
    "等待 allowlist / 转存",
  );
  push(
    "retry_transfer_allowed",
    true,
    guard,
    "retryTransfer 允许且不创建新 Provider 任务",
  );

  // 9) completed
  guard = await store.markCompleted({
    generationId: simGenerationId,
    providerTaskId: fakeProviderTaskId,
  });
  push("completed", guard.state === "completed", guard, "Simulation 完成");

  // 10) consumed 归档
  guard = await store.markConsumed();
  push("consumed", guard.state === "consumed", guard, "资格已归档");

  return {
    simulation: true,
    fakeProviderTaskId,
    steps,
    finalGuard: guard,
    createdFormalGeneration: false,
    createdFormalIdempotency: false,
    createdFormalVideoAsset: false,
    calledNetwork: false,
  };
}

export function assertRetryGenerationBlockedForLocalPaidTest(
  guardState: LocalPaidTestGuardState,
): void {
  if (
    guardState === "unarmed" ||
    guardState === "failedBeforeSubmit"
  ) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_NOT_ARMED");
  }
  if (guardState === "unknownOutcome") {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_UNKNOWN_OUTCOME");
  }
  if (guardState === "armed") {
    // armed 时也禁止走普通 retryGeneration 旁路；必须走一次性入口
    throw new LocalPaidTestError("LOCAL_PAID_TEST_ALREADY_CONSUMED");
  }
  throw new LocalPaidTestError("LOCAL_PAID_TEST_ALREADY_CONSUMED");
}
