import { resolveProviderAssets } from "../asset-resolver";
import {
  createGenerationId,
  readGenerationRecord,
  saveGenerationRecord,
  updateGenerationRecord,
} from "../generation-store";
import {
  IdempotencyError,
  IDEMPOTENCY_SCOPE,
  ProviderOutcomeUnknownError,
  UNKNOWN_OUTCOME_USER_MESSAGE,
  findActiveGenerationForShot,
  fingerprintInputFromGeneration,
  buildGenerationRequestFingerprint,
  getIdempotencyStore,
  type GenerationIdempotencyStore,
} from "../idempotency";
import {
  listCapabilitiesForProvider,
  pickCapability,
} from "../model-capabilities";
import {
  getVideoProviderRuntimeConfig,
  type VideoProviderRuntimeConfig,
} from "../provider/config";
import { createVideoProvider } from "../provider";
import type { VideoProvider } from "../provider/types";
import { buildInputSummary, selectWanGenerationMode } from "../select-wan-mode";
import { validateGenerationSettings } from "../validate-settings";
import type { GenerationRecord, VideoGenerationInput } from "../types";
import { LocalPaidTestError } from "./errors";
import type { WanLocalPaidTestGuardStore } from "./guard-store";
import { FileWanLocalPaidTestGuardStore } from "./guard-store";
import {
  assertLocalPaidTestEnvironmentAllowed,
  formatLocalDateYmd,
  getLocalPaidTestRuntimeConfig,
  isValidPriceConfirmedOn,
  validateMaxCostCny,
} from "./config";
import { assertLocalPaidTestSpec } from "./spec";
import {
  assertValidConfirmationPhrase,
  assertValidLocalPaidTestToken,
} from "./token";
import { verifyLocalPaidTestArmNonce } from "./arm-nonce";
import { assertPaidGenerationSubmissionPolicy } from "./paid-submission-policy";
import { isFakeLocalPaidTestProvider } from "./fake-provider";

function errorCodeOf(err: unknown): string {
  if (
    err instanceof Error &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
  ) {
    return (err as { code: string }).code;
  }
  return "SUBMIT_FAILED";
}

function errorMessageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export type LocalOneShotSubmitClientBody = {
  projectId: string;
  shotNodeId: string;
  confirmPaidGeneration: boolean;
  token: string;
  confirmationPhrase: string;
  armNonce: string;
  idempotencyKey: string;
};

export type SubmitWan27LocalOneShotPaidTestDeps = {
  env?: Record<string, string | undefined>;
  guardStore?: WanLocalPaidTestGuardStore;
  idempotencyStore?: GenerationIdempotencyStore;
  /**
   * Injected provider for tests only. Must be marked fake/simulation.
   * Production route never passes this — uses createVideoProvider.
   */
  provider?: VideoProvider;
  /** Pre-built input (tests). Production loads WorkflowDocument then builds. */
  generationInput: VideoGenerationInput;
  unsupportedAudioLabels?: string[];
  client: LocalOneShotSubmitClientBody;
  /** Reject if client body contained forbidden fields (set by route). */
  rejectedClientFields?: string[];
  runtimeConfig?: VideoProviderRuntimeConfig;
  title?: string;
};

/**
 * Dedicated local one-shot paid submit.
 * Order: validate → fingerprint → reserve → GenerationRecord → Guard submitting
 * → idempotency submitting → Provider → providerAccepted → Generation taskId → committed.
 */
export async function submitWan27LocalOneShotPaidTest(
  deps: SubmitWan27LocalOneShotPaidTestDeps,
): Promise<GenerationRecord> {
  const env = deps.env ?? process.env;
  assertLocalPaidTestEnvironmentAllowed(env);

  if (deps.rejectedClientFields && deps.rejectedClientFields.length > 0) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_CLIENT_FIELD_FORBIDDEN");
  }

  const client = deps.client;
  if (!client.confirmPaidGeneration) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_CONFIRM_REQUIRED");
  }
  if (!client.idempotencyKey.trim()) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_IDEMPOTENCY_REQUIRED");
  }
  if (!client.armNonce.trim()) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_NONCE_REQUIRED");
  }

  const cfg = getLocalPaidTestRuntimeConfig(env);
  if (!cfg.localPaidTestMode) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_DISABLED");
  }

  assertValidLocalPaidTestToken(client.token, cfg.token);
  assertValidConfirmationPhrase(client.confirmationPhrase);

  const today = formatLocalDateYmd();
  if (!cfg.priceConfirmedOn.trim()) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_PRICE_NOT_CONFIRMED");
  }
  if (!isValidPriceConfirmedOn(cfg.priceConfirmedOn, today)) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_PRICE_CONFIRMATION_EXPIRED");
  }
  const maxOk = validateMaxCostCny(cfg.maxCostCny);
  if (!maxOk.ok) {
    throw new LocalPaidTestError(maxOk.code);
  }

  const runtime =
    deps.runtimeConfig ?? getVideoProviderRuntimeConfig(env);
  const guardStore =
    deps.guardStore ??
    new FileWanLocalPaidTestGuardStore({ namespace: "live" });
  const store = deps.idempotencyStore ?? getIdempotencyStore();

  const guard = await guardStore.get();

  // Terminal / in-progress with same nonce+fingerprint → idempotent return
  if (
    guard.state === "submitting" ||
    guard.state === "providerAccepted" ||
    guard.state === "transferPending" ||
    guard.state === "completed" ||
    guard.state === "consumed" ||
    guard.state === "unknownOutcome"
  ) {
    if (!verifyLocalPaidTestArmNonce(client.armNonce, guard.armNonceHash)) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_NONCE_INVALID");
    }
    const input = deps.generationInput;
    assertLocalPaidTestSpec(input);
    const mode = selectWanGenerationMode(input);
    const capabilities = listCapabilitiesForProvider(runtime.providerId, {
      t2vModelId: runtime.t2vModelId,
      r2vModelId: runtime.r2vModelId,
    });
    const capability = pickCapability(capabilities, mode);
    const fingerprint = buildGenerationRequestFingerprint(
      fingerprintInputFromGeneration({
        input,
        providerId: runtime.providerId,
        modelId: capability.modelId,
      }),
    );
    if (
      guard.requestFingerprint &&
      guard.requestFingerprint !== fingerprint
    ) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_REQUEST_MISMATCH");
    }
    if (guard.state === "unknownOutcome") {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_UNKNOWN_OUTCOME");
    }
    if (guard.state === "consumed" && !guard.generationId) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_NONCE_REUSED");
    }
    if (guard.generationId) {
      const existing = await readGenerationRecord(guard.generationId);
      if (existing) return existing;
    }
    if (
      guard.state === "completed" ||
      guard.state === "consumed" ||
      guard.state === "providerAccepted" ||
      guard.state === "transferPending"
    ) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_NONCE_REUSED");
    }
    // submitting without readable generation yet
    throw new LocalPaidTestError("LOCAL_PAID_TEST_ALREADY_IN_PROGRESS");
  }

  if (guard.state !== "armed") {
    throw new LocalPaidTestError(
      guard.state === "failedBeforeSubmit" || guard.state === "unarmed"
        ? "LOCAL_PAID_TEST_NOT_ARMED"
        : "LOCAL_PAID_TEST_ALREADY_CONSUMED",
    );
  }

  if (!verifyLocalPaidTestArmNonce(client.armNonce, guard.armNonceHash)) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_NONCE_INVALID");
  }

  const input = deps.generationInput;
  if (
    input.projectId !== client.projectId ||
    input.shotId !== client.shotNodeId
  ) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_REQUEST_MISMATCH");
  }

  try {
    assertLocalPaidTestSpec(input);
  } catch (err) {
    if (err instanceof LocalPaidTestError) {
      await guardStore
        .markFailedBeforeSubmit({ errorCode: err.code })
        .catch(() => undefined);
    }
    throw err;
  }

  assertPaidGenerationSubmissionPolicy({
    source: "localOneShotPaidTest",
    runtimeConfig: runtime,
    env,
    localPaidTestContext: {
      armed: true,
      confirmPaidGeneration: true,
    },
    generationInput: input,
  });

  const mode = selectWanGenerationMode(input);
  const capabilities = listCapabilitiesForProvider(runtime.providerId, {
    t2vModelId: runtime.t2vModelId,
    r2vModelId: runtime.r2vModelId,
  });
  const capability = pickCapability(capabilities, mode);
  const unsupportedAudioLabels = deps.unsupportedAudioLabels ?? [];
  const summary = buildInputSummary(input, unsupportedAudioLabels);
  const settings = {
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    seed: input.seed,
    watermark: input.watermark,
    promptExtend: input.promptExtend,
  };
  const validation = validateGenerationSettings({
    capability,
    settings,
    inputSummary: summary,
  });
  if (validation.length > 0) {
    await guardStore.markFailedBeforeSubmit({
      errorCode: validation[0]!.code,
    });
    throw Object.assign(new Error(validation[0]!.message), {
      code: validation[0]!.code,
      errors: validation,
    });
  }

  const active = await findActiveGenerationForShot({
    projectId: input.projectId,
    shotNodeId: input.shotId,
    providerId: runtime.providerId,
  });
  if (active) {
    await guardStore.markFailedBeforeSubmit({
      errorCode: "LOCAL_PAID_TEST_ACTIVE_GENERATION_EXISTS",
    });
    throw new LocalPaidTestError("LOCAL_PAID_TEST_ACTIVE_GENERATION_EXISTS");
  }

  const fingerprint = buildGenerationRequestFingerprint(
    fingerprintInputFromGeneration({
      input,
      providerId: runtime.providerId,
      modelId: capability.modelId,
    }),
  );

  const provider =
    deps.provider ??
    createVideoProvider({
      config: runtime,
    });

  if (deps.provider && !isFakeLocalPaidTestProvider(deps.provider)) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
  }

  const resolvedMedia = await resolveProviderAssets(input, {
    forRealProvider: true,
  });

  let generationId = createGenerationId();
  const idempotencyKey = client.idempotencyKey;

  let outcome = await store.reserve({
    scope: IDEMPOTENCY_SCOPE,
    idempotencyKey,
    requestFingerprint: fingerprint,
    generationId,
    projectId: input.projectId,
    shotNodeId: input.shotId,
    providerId: runtime.providerId,
  });

  if (outcome.kind === "safe_retry") {
    const refreshed = await store.reReserveAfterSafeFailure({
      scope: IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestFingerprint: fingerprint,
      generationId,
      projectId: input.projectId,
      shotNodeId: input.shotId,
      providerId: runtime.providerId,
    });
    outcome = { kind: "reserved", record: refreshed };
  }

  if (outcome.kind === "existing") {
    const existing = await readGenerationRecord(outcome.record.generationId);
    if (existing) return existing;
    throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED", {
      generationId: outcome.record.generationId,
    });
  }
  if (outcome.kind === "in_progress") {
    const gen = await readGenerationRecord(outcome.record.generationId);
    if (gen) return gen;
    throw new IdempotencyError("IDEMPOTENCY_IN_PROGRESS", {
      generationId: outcome.record.generationId,
    });
  }
  if (outcome.kind === "blocked_unknown") {
    throw new IdempotencyError("GENERATION_SUBMISSION_UNKNOWN", {
      generationId: outcome.record.generationId,
    });
  }
  generationId = outcome.record.generationId;

  const now = new Date().toISOString();
  const mediaAssetIds = resolvedMedia.map((m) => m.assetId);

  let record: GenerationRecord = {
    id: generationId,
    projectId: input.projectId,
    shotNodeId: input.shotId,
    providerId: runtime.providerId,
    providerModelId: capability.modelId,
    providerTaskId: "",
    mode,
    status: "validating",
    progress: null,
    progressLabel: "校验中",
    isMock: false,
    requestSnapshot: {
      prompt: input.prompt,
      settings,
      mediaAssetIds,
      unsupportedAudioLabels,
    },
    requestedResolution: input.resolution,
    requestedAspectRatio: input.aspectRatio,
    requestedDurationSeconds: input.durationSeconds,
    providerResolution: null,
    providerAspectRatio: null,
    providerDurationSeconds: null,
    actualWidth: null,
    actualHeight: null,
    actualDurationSeconds: null,
    metadataSource: "none",
    remoteVideoUrl: null,
    localVideoAssetId: null,
    resultAsset: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    idempotencyKey,
    localOneShotPaidTest: true,
  };

  try {
    await saveGenerationRecord(record);
  } catch (err) {
    await store
      .markSafeFailure(
        IDEMPOTENCY_SCOPE,
        idempotencyKey,
        generationId,
        "GENERATION_RECORD_SAVE_FAILED",
      )
      .catch(() => undefined);
    await guardStore
      .markFailedBeforeSubmit({
        errorCode: "GENERATION_RECORD_SAVE_FAILED",
      })
      .catch(() => undefined);
    throw err;
  }

  try {
    await guardStore.markSubmitting({
      generationId,
      requestFingerprint: fingerprint,
    });
  } catch (err) {
    await store
      .markSafeFailure(
        IDEMPOTENCY_SCOPE,
        idempotencyKey,
        generationId,
        errorCodeOf(err),
      )
      .catch(() => undefined);
    throw err;
  }

  try {
    await store.markSubmitting(
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      generationId,
    );
    record = await updateGenerationRecord(generationId, {
      status: "submitting",
      progressLabel: "正在提交",
    });

    let submitted;
    try {
      submitted = await provider.submitGeneration({
        generationId,
        input,
        capability,
        resolvedMedia,
      });
    } catch (err) {
      if (
        err instanceof ProviderOutcomeUnknownError ||
        errorCodeOf(err) === "GENERATION_SUBMISSION_UNKNOWN"
      ) {
        await store.markUnknownOutcome(
          IDEMPOTENCY_SCOPE,
          idempotencyKey,
          generationId,
          "GENERATION_SUBMISSION_UNKNOWN",
        );
        await guardStore.markUnknownOutcome({
          generationId,
          errorCode: "GENERATION_SUBMISSION_UNKNOWN",
        });
        record = await updateGenerationRecord(generationId, {
          status: "unknownOutcome",
          errorCode: "GENERATION_SUBMISSION_UNKNOWN",
          errorMessage: UNKNOWN_OUTCOME_USER_MESSAGE,
          progressLabel: "提交结果待确认",
        });
        throw Object.assign(new Error(UNKNOWN_OUTCOME_USER_MESSAGE), {
          generation: record,
          code: "GENERATION_SUBMISSION_UNKNOWN",
        });
      }

      const code = errorCodeOf(err);
      const message = errorMessageOf(err, "提交失败");
      // Provider called but rejected with clear failure before accept —
      // treat as safeFailure + failedBeforeSubmit only if we are sure.
      // Once submitGeneration threw a normal error, prefer safeFailure;
      // Guard must not return to armed.
      await store
        .markSafeFailure(IDEMPOTENCY_SCOPE, idempotencyKey, generationId, code)
        .catch(() => undefined);
      await guardStore
        .markFailedBeforeSubmit({ errorCode: code })
        .catch(async () => {
          await guardStore
            .markUnknownOutcome({ generationId, errorCode: code })
            .catch(() => undefined);
        });
      record = await updateGenerationRecord(generationId, {
        status: "failed",
        errorCode: code,
        errorMessage: message,
        progressLabel: "提交失败",
      });
      throw Object.assign(new Error(message), { generation: record, code });
    }

    await store.markProviderAccepted(
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      generationId,
      submitted.providerTaskId,
    );

    await guardStore.markProviderAccepted({
      generationId,
      providerTaskId: submitted.providerTaskId,
    });

    try {
      record = await updateGenerationRecord(generationId, {
        providerTaskId: submitted.providerTaskId,
        status: submitted.status,
        progressLabel: submitted.progressLabel,
        progress: null,
      });
    } catch (err) {
      // Idempotency + Guard already have taskId; reconcile can repair Generation
      void err;
      throw err;
    }

    await store.markCommitted(
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      generationId,
    );

    return record;
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      ((err as { code?: string }).code === "GENERATION_SUBMISSION_UNKNOWN" ||
        "generation" in err)
    ) {
      throw err;
    }
    throw err;
  }
}
