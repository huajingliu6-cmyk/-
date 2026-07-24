import { resolveProviderAssets } from "./asset-resolver";
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
import type {
  GenerationRecord,
  VideoGenerationInput,
} from "./types";
import { validateGenerationSettings } from "./validate-settings";
import type { FetchLike } from "./provider/types";

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

  if (params.idempotencyKey) {
    rememberIdempotencyKey(params.idempotencyKey, id);
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

  // 已有本地结果则直接收口为完成，避免 Mock 内存任务丢失后把成功态刷成失败
  if (current.localVideoAssetId || current.resultAsset) {
    if (current.status === "downloading") {
      return updateGenerationRecord(generationId, {
        status: "completed",
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
    try {
      next = await updateGenerationRecord(generationId, {
        status: "downloading",
        progressLabel: next.isMock
          ? "Mock · 正在转存"
          : "正在转存结果视频",
        remoteVideoUrl: remoteUrl,
      });
      const transferred = await transferRemoteVideoToLocal({
        projectId: next.projectId,
        remoteVideoUrl: remoteUrl,
        title: options?.title ?? "镜头",
        generationId,
        isMock: next.isMock,
      });
      next = await updateGenerationRecord(generationId, {
        status: "completed",
        progressLabel: next.isMock
          ? "Mock 演示结果，不是真实 AI 视频"
          : "已完成",
        localVideoAssetId: transferred.asset.id,
        resultAsset: transferred.asset,
        completedAt: new Date().toISOString(),
        errorCode: null,
        errorMessage: null,
      });
    } catch (err) {
      next = await updateGenerationRecord(generationId, {
        status: "resultTransferFailed",
        errorCode: "RESULT_TRANSFER_FAILED",
        errorMessage:
          err instanceof Error ? err.message : "结果视频转存失败",
        progressLabel: "结果转存失败",
        remoteVideoUrl: remoteUrl,
      });
    }
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

export function getVideoGenerationPublicConfig() {
  return getPublicVideoConfig();
}
