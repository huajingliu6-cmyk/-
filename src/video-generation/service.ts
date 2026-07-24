import { resolveProviderAssets } from "./asset-resolver";
import { ALLOWED_GENERATED_VIDEO_MIME } from "./classify-generation-result";
import {
  createGenerationId,
  markPolled,
  readGenerationRecord,
  saveGenerationRecord,
  shouldThrottlePoll,
  updateGenerationRecord,
} from "./generation-store";
import {
  IdempotencyError,
  IDEMPOTENCY_SCOPE,
  ProviderOutcomeUnknownError,
  UNKNOWN_OUTCOME_USER_MESSAGE,
  FileGenerationIdempotencyStore,
  findActiveGenerationForShot,
  fingerprintInputFromGeneration,
  buildGenerationRequestFingerprint,
  getIdempotencyStore,
  reconcileByGenerationId,
  reconcileGenerationIdempotencyRecord,
} from "./idempotency";
import {
  listCapabilitiesForProvider,
  pickCapability,
} from "./model-capabilities";
import {
  getPublicVideoConfig,
  getVideoProviderRuntimeConfig,
  paidGenerationAllowed,
} from "./provider/config";
import { createVideoProvider } from "./provider";
import {
  buildInputSummary,
  selectWanGenerationMode,
} from "./select-wan-mode";
import { transferRemoteVideoToLocal } from "./transfer-video";
import { TransferError } from "./secure-transfer/errors";
import type {
  GenerationRecord,
  VideoGenerationInput,
} from "./types";
import type { AssetRecord } from "@/workflow/types";
import { validateGenerationSettings } from "./validate-settings";
import type { FetchLike } from "./provider/types";
import type { SafeDownloadDeps } from "./secure-transfer/safe-download";

/** 单进程内转存锁：防止轮询与手动 transfer 并发产生双份资产（非多实例方案） */
const transferInFlight = new Map<
  string,
  Promise<{
    generation: GenerationRecord;
    asset: AssetRecord | null;
    idempotent: boolean;
  }>
>();

function hasValidCompletedVideoAsset(record: GenerationRecord): boolean {
  const asset = record.resultAsset;
  if (!asset) return false;
  if (asset.assetType !== "generatedVideo") return false;
  if (!ALLOWED_GENERATED_VIDEO_MIME.has(asset.mimeType)) return false;
  if (!record.localVideoAssetId) return false;
  if (record.localVideoAssetId !== asset.id) return false;
  if (!Number.isFinite(asset.sizeBytes) || asset.sizeBytes <= 0) return false;
  return true;
}

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

async function returnExistingGeneration(
  generationId: string,
): Promise<GenerationRecord> {
  const existing = await readGenerationRecord(generationId);
  if (existing) return existing;
  throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED", {
    generationId,
  });
}

/**
 * 提交视频生成（Mock 与真实 Provider 同一状态机）。
 * 顺序：校验 → fingerprint → reserve → GenerationRecord → markSubmitting
 * → Provider → markProviderAccepted(taskId) → 更新 GenerationRecord → markCommitted。
 */
export async function submitVideoGeneration(params: {
  input: VideoGenerationInput;
  unsupportedAudioLabels: string[];
  confirmPaidGeneration: boolean;
  idempotencyKey?: string;
  title?: string;
  fetchImpl?: FetchLike;
  /**
   * retryGeneration：明确新费用语义；仍走同一提交状态机。
   * 若源任务为 unknownOutcome，须 acknowledgePossibleDuplicateCharge。
   */
  retryOfGenerationId?: string;
  acknowledgePossibleDuplicateCharge?: boolean;
}): Promise<GenerationRecord> {
  const runtime = getVideoProviderRuntimeConfig();
  const paidGate = paidGenerationAllowed(
    runtime,
    params.confirmPaidGeneration,
  );
  if (!paidGate.ok) {
    throw Object.assign(new Error(paidGate.message), {
      code: paidGate.code,
    });
  }

  if (params.retryOfGenerationId) {
    const previous = await readGenerationRecord(params.retryOfGenerationId);
    if (previous?.status === "unknownOutcome") {
      if (!params.acknowledgePossibleDuplicateCharge) {
        throw new IdempotencyError("DUPLICATE_CHARGE_ACK_REQUIRED");
      }
    }
    if (!params.idempotencyKey) {
      throw new IdempotencyError("IDEMPOTENCY_KEY_REQUIRED");
    }
  }

  const mode = selectWanGenerationMode(params.input);
  const capabilities = listCapabilitiesForProvider(runtime.providerId, {
    t2vModelId: runtime.t2vModelId,
    r2vModelId: runtime.r2vModelId,
  });
  const capability = pickCapability(capabilities, mode);
  const summary = buildInputSummary(
    params.input,
    params.unsupportedAudioLabels,
  );
  const settings = {
    resolution: params.input.resolution,
    aspectRatio: params.input.aspectRatio,
    durationSeconds: params.input.durationSeconds,
    seed: params.input.seed,
    watermark: params.input.watermark,
    promptExtend: params.input.promptExtend,
  };
  const validation = validateGenerationSettings({
    capability,
    settings,
    inputSummary: summary,
  });
  if (validation.length > 0) {
    throw Object.assign(new Error(validation[0]!.message), {
      code: validation[0]!.code,
      errors: validation,
    });
  }

  const resolvedMedia = await resolveProviderAssets(params.input, {
    forRealProvider: runtime.providerId === "aliyun-wan27",
  });

  const fingerprint = buildGenerationRequestFingerprint(
    fingerprintInputFromGeneration({
      input: params.input,
      providerId: runtime.providerId,
      modelId: capability.modelId,
    }),
  );

  const store = getIdempotencyStore();
  const idempotencyKey = params.idempotencyKey;

  if (idempotencyKey) {
    const prior = await store.get(IDEMPOTENCY_SCOPE, idempotencyKey);
    if (prior) {
      await reconcileGenerationIdempotencyRecord({
        scope: IDEMPOTENCY_SCOPE,
        idempotencyKey,
      });
    }
  }

  // 同镜头 active 保护（不同 key 的多标签并发）
  const active = await findActiveGenerationForShot({
    projectId: params.input.projectId,
    shotNodeId: params.input.shotId,
    providerId: runtime.providerId,
  });

  const currentIdem = idempotencyKey
    ? await store.get(IDEMPOTENCY_SCOPE, idempotencyKey)
    : null;

  if (active) {
    const sameTask =
      currentIdem !== null && currentIdem.generationId === active.id;
    if (!sameTask) {
      throw new IdempotencyError("ACTIVE_GENERATION_ALREADY_EXISTS", {
        generationId: active.id,
      });
    }
  }

  let generationId = createGenerationId();
  const reservedKey: string | null = idempotencyKey ?? null;

  if (idempotencyKey) {
    let outcome = await store.reserve({
      scope: IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestFingerprint: fingerprint,
      generationId,
      projectId: params.input.projectId,
      shotNodeId: params.input.shotId,
      providerId: runtime.providerId,
    });

    if (outcome.kind === "safe_retry") {
      if (store instanceof FileGenerationIdempotencyStore) {
        const refreshed = await store.reReserveAfterSafeFailure({
          scope: IDEMPOTENCY_SCOPE,
          idempotencyKey,
          requestFingerprint: fingerprint,
          generationId,
          projectId: params.input.projectId,
          shotNodeId: params.input.shotId,
          providerId: runtime.providerId,
        });
        outcome = { kind: "reserved", record: refreshed };
      } else {
        await store.releaseIfSafe(
          IDEMPOTENCY_SCOPE,
          idempotencyKey,
          outcome.record.generationId,
        );
        outcome = await store.reserve({
          scope: IDEMPOTENCY_SCOPE,
          idempotencyKey,
          requestFingerprint: fingerprint,
          generationId,
          projectId: params.input.projectId,
          shotNodeId: params.input.shotId,
          providerId: runtime.providerId,
        });
      }
    }

    if (outcome.kind === "existing") {
      return returnExistingGeneration(outcome.record.generationId);
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
  }

  const provider = createVideoProvider({
    config: runtime,
    fetchImpl: params.fetchImpl,
  });

  const now = new Date().toISOString();
  const mediaAssetIds = resolvedMedia.map((m) => m.assetId);

  let record: GenerationRecord = {
    id: generationId,
    projectId: params.input.projectId,
    shotNodeId: params.input.shotId,
    providerId: runtime.providerId,
    providerModelId: capability.modelId,
    providerTaskId: "",
    mode,
    status: "validating",
    progress: null,
    progressLabel: "校验中",
    isMock: runtime.providerId === "mock",
    requestSnapshot: {
      prompt: params.input.prompt,
      settings,
      mediaAssetIds,
      unsupportedAudioLabels: params.unsupportedAudioLabels,
    },
    requestedResolution: params.input.resolution,
    requestedAspectRatio: params.input.aspectRatio,
    requestedDurationSeconds: params.input.durationSeconds,
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
    idempotencyKey: idempotencyKey ?? null,
  };

  try {
    await saveGenerationRecord(record);
  } catch (err) {
    if (reservedKey) {
      await store
        .markSafeFailure(
          IDEMPOTENCY_SCOPE,
          reservedKey,
          generationId,
          "GENERATION_RECORD_SAVE_FAILED",
        )
        .catch(() => undefined);
    }
    throw err;
  }

  try {
    if (reservedKey) {
      await store.markSubmitting(
        IDEMPOTENCY_SCOPE,
        reservedKey,
        generationId,
      );
    }
    record = await updateGenerationRecord(generationId, {
      status: "submitting",
      progressLabel: "正在提交",
    });

    let submitted;
    try {
      submitted = await provider.submitGeneration({
        generationId,
        input: params.input,
        capability,
        resolvedMedia,
      });
    } catch (err) {
      if (
        err instanceof ProviderOutcomeUnknownError ||
        errorCodeOf(err) === "GENERATION_SUBMISSION_UNKNOWN"
      ) {
        if (reservedKey) {
          await store.markUnknownOutcome(
            IDEMPOTENCY_SCOPE,
            reservedKey,
            generationId,
            "GENERATION_SUBMISSION_UNKNOWN",
          );
        }
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
      if (reservedKey) {
        await store.markSafeFailure(
          IDEMPOTENCY_SCOPE,
          reservedKey,
          generationId,
          code,
        );
      }
      record = await updateGenerationRecord(generationId, {
        status: "failed",
        errorCode: code,
        errorMessage: message,
        progressLabel: "提交失败",
      });
      throw Object.assign(new Error(message), { generation: record, code });
    }

    // Provider 返回 taskId 后优先持久化到幂等记录
    if (reservedKey) {
      await store.markProviderAccepted(
        IDEMPOTENCY_SCOPE,
        reservedKey,
        generationId,
        submitted.providerTaskId,
      );
    }

    try {
      record = await updateGenerationRecord(generationId, {
        providerTaskId: submitted.providerTaskId,
        status: submitted.status,
        progressLabel: submitted.progressLabel,
        progress: null,
      });
    } catch (err) {
      // 幂等记录已有 taskId，后续对账可补写；不删除幂等记录
      if (reservedKey) {
        // 保持 providerAccepted，不 markCommitted
      }
      throw err;
    }

    if (reservedKey) {
      await store.markCommitted(
        IDEMPOTENCY_SCOPE,
        reservedKey,
        generationId,
      );
    }

    return record;
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code?: string }).code === "GENERATION_SUBMISSION_UNKNOWN"
    ) {
      throw err;
    }
    if (
      err instanceof Error &&
      "generation" in err
    ) {
      throw err;
    }
    throw err;
  }
}

/**
 * retryGeneration：新 generationId + 新幂等键 + 最新 Workflow；可能产生新费用。
 * 与 retryTransfer（不调用 Provider）严格区分。
 */
export async function retryVideoGeneration(params: {
  previousGenerationId: string;
  input: VideoGenerationInput;
  unsupportedAudioLabels: string[];
  confirmPaidGeneration: boolean;
  idempotencyKey: string;
  acknowledgePossibleDuplicateCharge?: boolean;
  title?: string;
  fetchImpl?: FetchLike;
}): Promise<GenerationRecord> {
  return submitVideoGeneration({
    input: params.input,
    unsupportedAudioLabels: params.unsupportedAudioLabels,
    confirmPaidGeneration: params.confirmPaidGeneration,
    idempotencyKey: params.idempotencyKey,
    title: params.title,
    fetchImpl: params.fetchImpl,
    retryOfGenerationId: params.previousGenerationId,
    acknowledgePossibleDuplicateCharge:
      params.acknowledgePossibleDuplicateCharge,
  });
}

export async function refreshGenerationStatus(
  generationId: string,
  options?: { title?: string; force?: boolean },
): Promise<GenerationRecord> {
  const current = await readGenerationRecord(generationId);
  if (!current) throw new Error("生成任务不存在");

  // GET 时可触发对账，但不创建新任务、不调用 Provider 提交
  if (current.idempotencyKey) {
    await reconcileByGenerationId(generationId).catch(() => null);
  }

  const afterReconcile = (await readGenerationRecord(generationId)) ?? current;

  if (
    afterReconcile.status === "completed" ||
    afterReconcile.status === "failed" ||
    afterReconcile.status === "cancelled" ||
    afterReconcile.status === "resultTransferFailed" ||
    afterReconcile.status === "unknownOutcome"
  ) {
    return afterReconcile;
  }

  if (afterReconcile.status === "submitting") {
    return afterReconcile;
  }

  // 已有合法 generatedVideo 则收口完成；缺任一关键条件不伪装 completed。
  if (hasValidCompletedVideoAsset(afterReconcile)) {
    if (
      afterReconcile.status === "downloading" ||
      afterReconcile.status === "processing"
    ) {
      return updateGenerationRecord(generationId, {
        status: "completed",
        localVideoAssetId: afterReconcile.resultAsset!.id,
        progressLabel: afterReconcile.isMock
          ? "Mock 演示结果，不是真实 AI 视频"
          : "已完成",
        completedAt: afterReconcile.completedAt ?? new Date().toISOString(),
        errorCode: null,
        errorMessage: null,
      });
    }
    return afterReconcile;
  }

  if (
    afterReconcile.resultAsset &&
    !hasValidCompletedVideoAsset(afterReconcile) &&
    (afterReconcile.status === "downloading" ||
      afterReconcile.status === "processing")
  ) {
    return updateGenerationRecord(generationId, {
      status: "resultTransferFailed",
      errorCode: "RESULT_ASSET_INCOMPLETE",
      errorMessage: "结果视频资产不完整，不能标记为已完成",
      progressLabel: "结果转存失败",
    });
  }

  if (!options?.force && shouldThrottlePoll(generationId)) {
    return afterReconcile;
  }
  markPolled(generationId);

  if (!afterReconcile.providerTaskId) {
    // 尝试从幂等记录补写
    if (afterReconcile.idempotencyKey) {
      const reconciled = await reconcileGenerationIdempotencyRecord({
        scope: IDEMPOTENCY_SCOPE,
        idempotencyKey: afterReconcile.idempotencyKey,
      }).catch(() => null);
      if (reconciled?.generation?.providerTaskId) {
        return reconciled.generation;
      }
    }
    return afterReconcile;
  }

  const provider = createVideoProvider();
  const status = await provider.getGenerationStatus(
    afterReconcile.providerTaskId,
  );

  let next = await updateGenerationRecord(generationId, {
    status: status.status,
    progressLabel: status.progressLabel,
    progress: null,
    remoteVideoUrl: status.remoteVideoUrl ?? afterReconcile.remoteVideoUrl,
    providerResolution:
      status.providerResolution ?? afterReconcile.providerResolution,
    providerAspectRatio:
      status.providerAspectRatio ?? afterReconcile.providerAspectRatio,
    providerDurationSeconds:
      status.providerDurationSeconds ?? afterReconcile.providerDurationSeconds,
    errorCode: status.errorCode ?? afterReconcile.errorCode,
    errorMessage: status.errorMessage ?? afterReconcile.errorMessage,
  });

  const remoteUrl = status.remoteVideoUrl ?? next.remoteVideoUrl;
  if (
    remoteUrl &&
    (status.status === "downloading" || status.rawTaskStatus === "SUCCEEDED") &&
    !next.localVideoAssetId
  ) {
    const transferred = await retryTransferGeneration(generationId, {
      title: options?.title ?? "镜头",
    }).catch(async (err) => {
      const failed = await readGenerationRecord(generationId);
      if (failed) return { generation: failed, asset: null, idempotent: false };
      throw err;
    });
    next = transferred.generation;
  }

  return next;
}

export async function cancelVideoGeneration(
  generationId: string,
): Promise<GenerationRecord> {
  const current = await readGenerationRecord(generationId);
  if (!current) throw new Error("生成任务不存在");
  if (current.status !== "queued" && current.status !== "validating") {
    throw Object.assign(
      new Error("仅排队中的任务可以取消；生成中无法伪装为取消成功"),
      { code: "CANCEL_NOT_ALLOWED" },
    );
  }
  const provider = createVideoProvider();
  const result = await provider.cancelGeneration(current.providerTaskId);
  if (!result.cancelled) {
    throw Object.assign(new Error(result.message), {
      code: "CANCEL_FAILED",
    });
  }
  return updateGenerationRecord(generationId, {
    status: "cancelled",
    progressLabel: "已取消",
    completedAt: new Date().toISOString(),
  });
}

/**
 * 转存重试（幂等）：已有有效 generatedVideo 时不重复复制文件。
 * 不调用 Provider，不生成新的付费任务。
 * 单进程内对同一 generationId 串行化；多实例生产需共享锁/唯一约束，本函数不提供。
 */
export async function retryTransferGeneration(
  generationId: string,
  options?: { title?: string; downloadDeps?: SafeDownloadDeps },
): Promise<{
  generation: GenerationRecord;
  asset: AssetRecord | null;
  idempotent: boolean;
}> {
  const existing = transferInFlight.get(generationId);
  if (existing) return existing;

  const run = (async () => {
    const record = await readGenerationRecord(generationId);
    if (!record) {
      throw Object.assign(new Error("任务不存在"), { code: "NOT_FOUND" });
    }

    if (hasValidCompletedVideoAsset(record)) {
      if (record.status === "completed") {
        return {
          generation: record,
          asset: record.resultAsset,
          idempotent: true,
        };
      }
      const recovered = await updateGenerationRecord(generationId, {
        status: "completed",
        localVideoAssetId: record.resultAsset!.id,
        progressLabel: record.isMock
          ? "Mock 演示结果，不是真实 AI 视频"
          : "已完成",
        completedAt: record.completedAt ?? new Date().toISOString(),
        errorCode: null,
        errorMessage: null,
      });
      return {
        generation: recovered,
        asset: recovered.resultAsset,
        idempotent: true,
      };
    }

    if (!record.remoteVideoUrl) {
      throw new TransferError("NO_REMOTE_URL");
    }

    await updateGenerationRecord(generationId, {
      status: "downloading",
      progressLabel: record.isMock
        ? "Mock · 正在转存"
        : "正在转存结果视频",
      remoteVideoUrl: record.remoteVideoUrl,
    });

    try {
      const transferred = await transferRemoteVideoToLocal({
        projectId: record.projectId,
        remoteVideoUrl: record.remoteVideoUrl,
        title: options?.title ?? "镜头",
        generationId,
        providerId: record.providerId,
        isMock: record.isMock,
        downloadDeps: options?.downloadDeps,
      });
      if (
        transferred.asset.assetType !== "generatedVideo" ||
        !ALLOWED_GENERATED_VIDEO_MIME.has(transferred.asset.mimeType) ||
        transferred.asset.sizeBytes <= 0
      ) {
        throw new TransferError("RESULT_VIDEO_STRUCTURE_INVALID");
      }
      const generation = await updateGenerationRecord(generationId, {
        status: "completed",
        localVideoAssetId: transferred.asset.id,
        resultAsset: transferred.asset,
        progressLabel: record.isMock
          ? "Mock 演示结果，不是真实 AI 视频"
          : "已完成",
        completedAt: new Date().toISOString(),
        errorCode: null,
        errorMessage: null,
      });
      return {
        generation,
        asset: transferred.asset,
        idempotent: false,
      };
    } catch (err) {
      const code =
        err instanceof TransferError
          ? err.code
          : "RESULT_TRANSFER_FAILED";
      const message =
        err instanceof TransferError
          ? err.message
          : err instanceof Error
            ? err.message
            : "结果视频转存失败";
      await updateGenerationRecord(generationId, {
        status: "resultTransferFailed",
        errorCode: code,
        errorMessage: message,
        progressLabel: "结果转存失败",
        remoteVideoUrl: record.remoteVideoUrl,
      });
      throw Object.assign(new Error(message), { code });
    }
  })();

  transferInFlight.set(generationId, run);
  try {
    return await run;
  } finally {
    transferInFlight.delete(generationId);
  }
}

export function getVideoGenerationPublicConfig() {
  return getPublicVideoConfig();
}
