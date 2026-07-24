import { resolveProviderAssets } from "./asset-resolver";
import { ALLOWED_GENERATED_VIDEO_MIME } from "./classify-generation-result";
import {
  createGenerationId,
  findIdempotentGeneration,
  markPolled,
  readGenerationRecord,
  rememberIdempotencyKey,
  saveGenerationRecord,
  shouldThrottlePoll,
  updateGenerationRecord,
} from "./generation-store";
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

export async function submitVideoGeneration(params: {
  input: VideoGenerationInput;
  unsupportedAudioLabels: string[];
  confirmPaidGeneration: boolean;
  idempotencyKey?: string;
  title?: string;
  fetchImpl?: FetchLike;
}): Promise<GenerationRecord> {
  if (params.idempotencyKey) {
    const existingId = findIdempotentGeneration(params.idempotencyKey);
    if (existingId) {
      const existing = await readGenerationRecord(existingId);
      if (existing) return existing;
    }
  }

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

  const provider = createVideoProvider({
    config: runtime,
    fetchImpl: params.fetchImpl,
  });

  const id = createGenerationId();
  const now = new Date().toISOString();
  const mediaAssetIds = resolvedMedia.map((m) => m.assetId);

  // 在落盘与 Provider 提交前登记幂等键，避免并发相同 key 创建多条任务
  if (params.idempotencyKey) {
    rememberIdempotencyKey(params.idempotencyKey, id);
  }

  let record: GenerationRecord = {
    id,
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
      /** 真正发送的素材顺序（含首帧在 resolved 中的位置） */
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
    idempotencyKey: params.idempotencyKey ?? null,
  };
  await saveGenerationRecord(record);

  try {
    const submitted = await provider.submitGeneration({
      generationId: id,
      input: params.input,
      capability,
      resolvedMedia,
    });
    record = await updateGenerationRecord(id, {
      providerTaskId: submitted.providerTaskId,
      status: submitted.status,
      progressLabel: submitted.progressLabel,
      progress: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "提交失败";
    const code =
      err instanceof Error &&
      "code" in err &&
      typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "SUBMIT_FAILED";
    record = await updateGenerationRecord(id, {
      status: "failed",
      errorCode: code,
      errorMessage: message,
      progressLabel: "提交失败",
    });
    throw Object.assign(new Error(message), { generation: record, code });
  }

  return record;
}

export async function refreshGenerationStatus(
  generationId: string,
  options?: { title?: string; force?: boolean },
): Promise<GenerationRecord> {
  const current = await readGenerationRecord(generationId);
  if (!current) throw new Error("生成任务不存在");

  if (
    current.status === "completed" ||
    current.status === "failed" ||
    current.status === "cancelled" ||
    current.status === "resultTransferFailed"
  ) {
    return current;
  }

  // 已有合法 generatedVideo 则收口完成；缺任一关键条件不伪装 completed。
  if (hasValidCompletedVideoAsset(current)) {
    if (current.status === "downloading" || current.status === "processing") {
      return updateGenerationRecord(generationId, {
        status: "completed",
        localVideoAssetId: current.resultAsset!.id,
        progressLabel: current.isMock
          ? "Mock 演示结果，不是真实 AI 视频"
          : "已完成",
        completedAt: current.completedAt ?? new Date().toISOString(),
        errorCode: null,
        errorMessage: null,
      });
    }
    return current;
  }

  // 有残缺结果资产但不完整：保持/标为转存失败，不回退图片、不伪造完成
  if (
    current.resultAsset &&
    !hasValidCompletedVideoAsset(current) &&
    (current.status === "downloading" || current.status === "processing")
  ) {
    return updateGenerationRecord(generationId, {
      status: "resultTransferFailed",
      errorCode: "RESULT_ASSET_INCOMPLETE",
      errorMessage: "结果视频资产不完整，不能标记为已完成",
      progressLabel: "结果转存失败",
    });
  }

  if (!options?.force && shouldThrottlePoll(generationId)) {
    return current;
  }
  markPolled(generationId);

  if (!current.providerTaskId) {
    return current;
  }

  const provider = createVideoProvider();
  const status = await provider.getGenerationStatus(current.providerTaskId);

  let next = await updateGenerationRecord(generationId, {
    status: status.status,
    progressLabel: status.progressLabel,
    progress: null,
    remoteVideoUrl: status.remoteVideoUrl ?? current.remoteVideoUrl,
    providerResolution:
      status.providerResolution ?? current.providerResolution,
    providerAspectRatio:
      status.providerAspectRatio ?? current.providerAspectRatio,
    providerDurationSeconds:
      status.providerDurationSeconds ?? current.providerDurationSeconds,
    errorCode: status.errorCode ?? current.errorCode,
    errorMessage: status.errorMessage ?? current.errorMessage,
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
