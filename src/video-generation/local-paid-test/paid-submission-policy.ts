import { LocalPaidTestError } from "./errors";
import {
  assertLocalPaidTestEnvironmentAllowed,
  getLocalPaidTestRuntimeConfig,
} from "./config";
import type { VideoProviderRuntimeConfig } from "../provider/config";
import type { VideoGenerationInput } from "../types";

export type PaidGenerationSubmissionSource =
  | "normalGenerationApi"
  | "localOneShotPaidTest"
  | "retryGeneration";

export type PaidGenerationSubmissionPolicyInput = {
  source: PaidGenerationSubmissionSource;
  runtimeConfig: VideoProviderRuntimeConfig;
  env?: Record<string, string | undefined>;
  /** Present only for local one-shot path after Guard/token checks */
  localPaidTestContext?: {
    armed: boolean;
    confirmPaidGeneration: boolean;
  };
  generationInput?: VideoGenerationInput;
};

/**
 * Single server-side gate for any real Provider submission.
 * Ordinary generation / retry must never create real Aliyun tasks;
 * only the dedicated local one-shot submit path may.
 */
export function assertPaidGenerationSubmissionPolicy(
  input: PaidGenerationSubmissionPolicyInput,
): void {
  const env = input.env ?? process.env;
  const isAliyun = input.runtimeConfig.providerId === "aliyun-wan27";

  if (input.source === "normalGenerationApi") {
    if (isAliyun) {
      throw new LocalPaidTestError("PAID_SUBMISSION_REQUIRES_LOCAL_TEST_GATE");
    }
    return;
  }

  if (input.source === "retryGeneration") {
    const cfg = getLocalPaidTestRuntimeConfig(env);
    if (cfg.localPaidTestMode || isAliyun) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_ALREADY_CONSUMED");
    }
    return;
  }

  // localOneShotPaidTest
  assertLocalPaidTestEnvironmentAllowed(env);
  const cfg = getLocalPaidTestRuntimeConfig(env);
  if (!cfg.localPaidTestMode) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_DISABLED");
  }
  if (!input.localPaidTestContext?.confirmPaidGeneration) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_CONFIRM_REQUIRED");
  }
  if (!input.localPaidTestContext.armed) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_NOT_ARMED");
  }
  if (!isAliyun) {
    // One-shot path requires server-side aliyun configuration (or injected fake).
    throw new LocalPaidTestError("LOCAL_PAID_TEST_DISABLED");
  }
}
