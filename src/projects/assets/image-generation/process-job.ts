import "server-only";

import { estimateImageJobPercent } from "@/projects/assets/image-generation/estimated-progress";
import { mapImageGenerationError } from "@/projects/assets/image-generation/map-error";
import {
  findActiveImageJobForSubject,
  findImageJobByIdempotencyKey,
  readImageGenerationJob,
  saveImageGenerationJob,
  updateImageGenerationJob,
  createImageJobId,
} from "@/projects/assets/image-generation/store";
import type {
  ImageGenerationJob,
  ImageGenerationJobParams,
  ImageGenerationSourceEntry,
  ImageGenerationSubjectKind,
} from "@/projects/assets/image-generation/types";
import { IMAGE_ERROR_USER_MESSAGE } from "@/projects/assets/image-generation/types";
import { generateDesignAssetImage } from "@/projects/assets/episode-design/generate-design-asset-image";
import type { ParsedGenerateAssetReferenceImage } from "@/projects/assets/episode-design/parse-generate-asset-request";
import { isDesignImageModelId } from "@/projects/assets/episode-design/image-generation-models";
import {
  isDesignImageCount,
  isDesignImageQuality,
} from "@/projects/assets/episode-design/image-generation-options";
import {
  releaseGenerationCredits,
  settleGenerationCredits,
} from "@/credits/generation-billing";
import { estimateAssetImageCredits } from "@/credits/generation-pricing";
import { createNotification } from "@/notifications/store";
import type { AssetBundleStoreScope } from "@/projects/assets/asset-bundle-scope";
import { getImageWorkerInstanceId } from "@/projects/assets/image-generation/worker-instance";
import {
  applyImageJobOwnedPatch,
  createImageJobLeaseToken,
  touchImageJobHeartbeat,
} from "@/projects/assets/image-generation/worker-lease";
import { buildRetrySnapshot } from "@/projects/assets/image-generation/retry-snapshot";
import {
  loadReferenceImagesFromStorageKeys,
  persistEnqueueReferenceImages,
} from "@/projects/assets/image-generation/temp-reference-storage";
import { assertTempReferenceQuotaAllows } from "@/projects/assets/image-generation/temp-reference-quota";
import { linkDesignItemJobResult } from "@/projects/assets/image-generation/link-design-item-result";

const DEFAULT_WAIT_MS = 3 * 60 * 1000;
const EXTEND_WAIT_MS = 5 * 60 * 1000;

type ProcessorsGlobal = typeof globalThis & {
  __infiniteCanvasImageJobProcessors?: Set<string>;
};

function processors(): Set<string> {
  const g = globalThis as ProcessorsGlobal;
  if (!g.__infiniteCanvasImageJobProcessors) {
    g.__infiniteCanvasImageJobProcessors = new Set();
  }
  return g.__infiniteCanvasImageJobProcessors;
}

export async function createAndEnqueueImageJob(input: {
  projectId: string;
  scope: AssetBundleStoreScope;
  subjectKind: ImageGenerationSubjectKind;
  subjectId: string;
  assetKind?: "character" | "scene" | "prop";
  episodeId?: string | null;
  actorUserId: string;
  params: ImageGenerationJobParams;
  idempotencyKey: string | null;
  creditReservationId: string | null;
  referenceImages: ParsedGenerateAssetReferenceImage[];
  effectivePrompt: string;
  model?: string;
  sourceEntry?: ImageGenerationSourceEntry;
  libraryReferenceMediaIds?: string[];
  negativePrompt?: string | null;
  seed?: string | null;
  strength?: number | null;
  /** When true, skip writing temp refs (already persisted / retry path). */
  skipPersistReferences?: boolean;
  /** When false, caller must invoke processImageJob (tests). Default true. */
  autoStart?: boolean;
}): Promise<
  | { ok: true; job: ImageGenerationJob; reusedIdempotency?: boolean }
  | { ok: false; status: number; code: string; message: string; job?: ImageGenerationJob }
> {
  if (input.idempotencyKey) {
    const prior = await findImageJobByIdempotencyKey({
      projectId: input.projectId,
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
    });
    if (prior) {
      return { ok: true, job: prior, reusedIdempotency: true };
    }
  }

  const active = await findActiveImageJobForSubject({
    projectId: input.projectId,
    scope: input.scope,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
  });
  if (active) {
    return {
      ok: false,
      status: 409,
      code: "GENERATION_IN_PROGRESS",
      message: IMAGE_ERROR_USER_MESSAGE.GENERATION_IN_PROGRESS,
      job: active,
    };
  }

  const sourceEntry = input.sourceEntry ?? input.params.retrySnapshot?.sourceEntry ?? "unknown";
  let retrySnapshot = input.params.retrySnapshot ?? null;
  let heldReferences = input.referenceImages;

  if (!input.skipPersistReferences) {
    const libraryIds = input.libraryReferenceMediaIds ?? [];
    const libraryOnly =
      libraryIds.length > 0 &&
      libraryIds.length === input.referenceImages.length;
    // Library-only refs are already durable — do not count them toward temp quota
    // or rewrite them as tmpref_* (local sidecar fails under REMOTE_DATA_ONLY).
    const projectedBytes = libraryOnly
      ? 0
      : input.referenceImages.reduce(
          (sum, image) => sum + image.buffer.byteLength,
          0,
        );
    const quota = await assertTempReferenceQuotaAllows({
      projectId: input.projectId,
      additionalBytes: projectedBytes,
    });
    if (!quota.ok) {
      return {
        ok: false,
        status: 413,
        code: quota.code,
        message: quota.message,
      };
    }
    const persisted = await persistEnqueueReferenceImages({
      projectId: input.projectId,
      referenceImages: input.referenceImages,
      libraryReferenceMediaIds: libraryIds,
    });
    retrySnapshot = buildRetrySnapshot({
      prompt: input.params.prompt,
      negativePrompt: input.negativePrompt ?? null,
      mode: input.params.mode,
      model: input.model ?? input.params.model ?? null,
      quality: input.params.quality ?? null,
      aspectRatio: input.params.aspectRatio ?? null,
      count: input.params.count ?? null,
      seed: input.seed ?? null,
      strength: input.strength ?? null,
      effectivePrompt: input.effectivePrompt,
      referenceStorageKeys: persisted.referenceStorageKeys,
      libraryReferenceMediaIds: persisted.libraryReferenceMediaIds,
      multiAngleMode: input.params.multiAngleMode ?? null,
      sceneCharacterPlacementsJson:
        input.params.sceneCharacterPlacementsJson ?? null,
      sourceEntry,
    });
  } else if (!retrySnapshot) {
    return {
      ok: false,
      status: 409,
      code: "RETRY_PAYLOAD_INCOMPLETE",
      message: IMAGE_ERROR_USER_MESSAGE.RETRY_PAYLOAD_INCOMPLETE,
    };
  }

  const now = new Date().toISOString();
  const workerInstanceId = getImageWorkerInstanceId();
  const leaseToken = createImageJobLeaseToken();
  const job: ImageGenerationJob = {
    recordType: "image",
    id: createImageJobId(),
    projectId: input.projectId,
    scope: input.scope,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    assetKind: input.assetKind,
    episodeId: input.episodeId ?? null,
    actorUserId: input.actorUserId,
    status: "queued",
    params: {
      ...input.params,
      retrySnapshot,
      referenceMediaIds:
        retrySnapshot?.libraryReferenceMediaIds ??
        input.params.referenceMediaIds,
    },
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    waitDeadlineAt: new Date(Date.now() + DEFAULT_WAIT_MS).toISOString(),
    errorCode: null,
    errorMessage: null,
    errorFields: [],
    mediaIds: [],
    primaryMediaId: null,
    mimeType: null,
    savedToLibrary: false,
    saveErrorMessage: null,
    notificationSent: false,
    estimatedPercent: 4,
    creditReservationId: input.creditReservationId,
    workerInstanceId,
    leaseToken,
    heartbeatAt: now,
    providerTaskId: null,
    resultClaimed: false,
    sourceEntry,
  };
  await saveImageGenerationJob(job);

  if (input.autoStart !== false) {
    void processImageJob(job.id, {
      referenceImages: heldReferences,
      effectivePrompt: input.effectivePrompt,
      model: input.model,
    }).catch((error) => {
      console.error(`[image-job] process failed ${job.id}:`, error);
    });
  }

  return { ok: true, job };
}

export async function processImageJob(
  jobId: string,
  runtime?: {
    referenceImages?: ParsedGenerateAssetReferenceImage[];
    effectivePrompt?: string;
    model?: string;
  },
): Promise<ImageGenerationJob | null> {
  if (processors().has(jobId)) {
    return readImageGenerationJob(jobId);
  }
  processors().add(jobId);
  try {
    let job = await readImageGenerationJob(jobId);
    if (!job) return null;
    if (job.status === "succeeded" || job.status === "failed" || job.status === "save_failed") {
      return job;
    }

    const leaseToken = job.leaseToken ?? createImageJobLeaseToken();
    if (!job.leaseToken) {
      job = await updateImageGenerationJob(jobId, { leaseToken });
    }

    let referenceImages = runtime?.referenceImages ?? [];
    if (referenceImages.length === 0) {
      const snap = job.params.retrySnapshot;
      const keys = [
        ...(snap?.referenceStorageKeys ?? []),
        ...(snap?.libraryReferenceMediaIds ?? []),
      ];
      if (keys.length > 0) {
        const loaded = await loadReferenceImagesFromStorageKeys({
          projectId: job.projectId,
          keys,
        });
        if (!loaded.ok) {
          const failed = await applyImageJobOwnedPatch(jobId, leaseToken, {
            status: "failed",
            completedAt: new Date().toISOString(),
            errorCode: "REFERENCE_IMAGE_REQUIRED",
            errorMessage: loaded.message,
            errorFields: ["referenceImages"],
            estimatedPercent: 100,
            creditReservationId: null,
            resultClaimed: true,
          });
          if (failed.ok) await maybeNotify(failed.job);
          return failed.job;
        }
        referenceImages = loaded.images;
      }
    }

    const effectivePrompt =
      runtime?.effectivePrompt ||
      job.params.retrySnapshot?.effectivePrompt ||
      job.params.prompt;

    const startedAt = new Date().toISOString();
    const running = await applyImageJobOwnedPatch(jobId, leaseToken, {
      status: "running",
      startedAt,
      workerInstanceId: getImageWorkerInstanceId(),
      estimatedPercent: estimateImageJobPercent({
        status: "running",
        startedAt,
        createdAt: job.createdAt,
      }),
    });
    if (!running.ok) return running.job;
    job = running.job;

    const heartbeat = setInterval(() => {
      void touchImageJobHeartbeat(jobId, leaseToken);
    }, 15_000);

    let generated: Awaited<ReturnType<typeof generateDesignAssetImage>>;
    try {
      const model =
        runtime?.model && isDesignImageModelId(runtime.model)
          ? runtime.model
          : job.params.model && isDesignImageModelId(job.params.model)
            ? job.params.model
            : undefined;
      generated = await generateDesignAssetImage({
        projectId: job.projectId,
        assetType: job.assetKind ?? "character",
        assetName: job.subjectId,
        prompt: effectivePrompt,
        quality: isDesignImageQuality(job.params.quality)
          ? job.params.quality
          : undefined,
        aspectRatio:
          job.params.aspectRatio === "16:9" ||
          job.params.aspectRatio === "9:16" ||
          job.params.aspectRatio === "1:1"
            ? job.params.aspectRatio
            : undefined,
        count: isDesignImageCount(job.params.count) ? job.params.count : undefined,
        model,
        useRawPrompt: Boolean(job.params.multiAngleMode),
        referenceImages,
      });
    } catch (error) {
      clearInterval(heartbeat);
      if (job.creditReservationId) {
        await releaseGenerationCredits({
          reservationId: job.creditReservationId,
          projectId: job.projectId,
          reason: "image-job-provider-failed",
        }).catch(() => undefined);
      }
      const mapped = mapImageGenerationError({
        code:
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : null,
        message: error instanceof Error ? error.message : null,
        status:
          error && typeof error === "object" && "status" in error
            ? Number((error as { status: unknown }).status)
            : 500,
      });
      const failed = await applyImageJobOwnedPatch(jobId, leaseToken, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorCode: mapped.code,
        errorMessage: mapped.message,
        errorFields: mapped.fields,
        estimatedPercent: 100,
        creditReservationId: null,
        resultClaimed: true,
      });
      if (failed.ok) await maybeNotify(failed.job);
      return failed.job;
    }

    clearInterval(heartbeat);

    const mediaIds = generated.images.map((image) => image.mediaId);
    const saving = await applyImageJobOwnedPatch(jobId, leaseToken, {
      status: "saving",
      mediaIds,
      primaryMediaId: generated.mediaId,
      mimeType: generated.images[0]?.mimeType ?? "image/png",
      estimatedPercent: 90,
    });
    if (!saving.ok) return saving.job;
    job = saving.job;

    try {
      if (job.creditReservationId) {
        const actualPoints = estimateAssetImageCredits(
          null,
          generated.count,
        ).points;
        await settleGenerationCredits({
          reservationId: job.creditReservationId,
          projectId: job.projectId,
          actualPoints,
          reason: "image-job-settle",
        });
      }

      if (job.subjectKind === "design_item") {
        const linked = await linkDesignItemJobResult({
          ...job,
          mediaIds,
          primaryMediaId: generated.mediaId,
          mimeType: generated.images[0]?.mimeType ?? "image/png",
        });
        if (!linked.ok) {
          const saveFailed = await applyImageJobOwnedPatch(jobId, leaseToken, {
            status: "save_failed",
            completedAt: new Date().toISOString(),
            savedToLibrary: false,
            saveErrorMessage: linked.message,
            errorCode: "SAVE_FAILED",
            errorMessage: IMAGE_ERROR_USER_MESSAGE.SAVE_FAILED,
            estimatedPercent: 100,
            creditReservationId: null,
            resultClaimed: true,
          });
          if (saveFailed.ok) await maybeNotify(saveFailed.job);
          return saveFailed.job;
        }
      }

      const succeeded = await applyImageJobOwnedPatch(jobId, leaseToken, {
        status: "succeeded",
        completedAt: new Date().toISOString(),
        savedToLibrary: job.subjectKind === "design_item",
        estimatedPercent: 100,
        creditReservationId: null,
        errorCode: null,
        errorMessage: null,
        resultClaimed: true,
      });
      if (succeeded.ok) await maybeNotify(succeeded.job);
      return succeeded.job;
    } catch (error) {
      const saveFailed = await applyImageJobOwnedPatch(jobId, leaseToken, {
        status: "save_failed",
        completedAt: new Date().toISOString(),
        savedToLibrary: false,
        saveErrorMessage:
          error instanceof Error ? error.message : "保存到资产库失败",
        errorCode: "SAVE_FAILED",
        errorMessage: IMAGE_ERROR_USER_MESSAGE.SAVE_FAILED,
        estimatedPercent: 100,
        creditReservationId: null,
        resultClaimed: true,
      });
      if (saveFailed.ok) await maybeNotify(saveFailed.job);
      return saveFailed.job;
    }
  } finally {
    processors().delete(jobId);
  }
}

async function maybeNotify(job: ImageGenerationJob): Promise<void> {
  if (job.notificationSent) return;
  if (job.status !== "succeeded" && job.status !== "failed" && job.status !== "save_failed") {
    return;
  }
  try {
    const type =
      job.status === "succeeded"
        ? ("image_generation_succeeded" as const)
        : ("image_generation_failed" as const);
    await createNotification({
      recipientUserId: job.actorUserId,
      type,
      projectId: job.projectId,
      episodeId: job.episodeId ?? "",
      submissionId: job.id,
      submitterUserId: job.actorUserId,
      title:
        job.status === "succeeded"
          ? "图片生成完成"
          : job.status === "save_failed"
            ? "图片已生成，保存失败"
            : job.errorCode === "PROCESS_RESTARTED"
              ? "生成任务已中断"
              : "图片生成失败",
      summary:
        job.status === "succeeded"
          ? "点击查看最新生成结果"
          : job.errorMessage ?? IMAGE_ERROR_USER_MESSAGE.UNKNOWN_ERROR,
      dedupeBySubmissionId: true,
    });
    await updateImageGenerationJob(job.id, { notificationSent: true });
  } catch (error) {
    console.error(`[image-job] notify failed ${job.id}:`, error);
  }
}

export async function markImageJobSaved(
  jobId: string,
): Promise<ImageGenerationJob | null> {
  const job = await readImageGenerationJob(jobId);
  if (!job) return null;
  return updateImageGenerationJob(jobId, {
    status: "succeeded",
    savedToLibrary: true,
    saveErrorMessage: null,
    errorCode: null,
    errorMessage: null,
  });
}

export async function markImageJobSaveFailed(
  jobId: string,
  message: string,
): Promise<ImageGenerationJob | null> {
  const job = await readImageGenerationJob(jobId);
  if (!job) return null;
  return updateImageGenerationJob(jobId, {
    status: "save_failed",
    savedToLibrary: false,
    saveErrorMessage: message,
    errorCode: "SAVE_FAILED",
    errorMessage: IMAGE_ERROR_USER_MESSAGE.SAVE_FAILED,
  });
}

export async function extendImageJobWait(
  jobId: string,
): Promise<ImageGenerationJob | null> {
  const job = await readImageGenerationJob(jobId);
  if (!job) return null;
  if (job.status === "succeeded" || job.status === "failed" || job.status === "save_failed") {
    return job;
  }
  const base = Math.max(
    Date.now(),
    job.waitDeadlineAt ? Date.parse(job.waitDeadlineAt) : Date.now(),
  );
  return updateImageGenerationJob(jobId, {
    status: "timed_out_waiting",
    waitDeadlineAt: new Date(base + EXTEND_WAIT_MS).toISOString(),
  });
}

export async function markImageJobClientTimedOut(
  jobId: string,
): Promise<ImageGenerationJob | null> {
  const job = await readImageGenerationJob(jobId);
  if (!job) return null;
  if (job.status === "succeeded" || job.status === "failed" || job.status === "save_failed") {
    return job;
  }
  return updateImageGenerationJob(jobId, {
    status: "timed_out_waiting",
    errorCode: "TIMED_OUT",
    errorMessage: IMAGE_ERROR_USER_MESSAGE.TIMED_OUT,
  });
}

export async function failImageJobAfterExtendedWait(
  jobId: string,
): Promise<ImageGenerationJob | null> {
  const job = await readImageGenerationJob(jobId);
  if (!job) return null;
  if (job.status === "succeeded" || job.status === "save_failed") return job;
  if (job.status === "failed") return job;
  if (job.status === "running" || job.status === "queued" || job.status === "saving" || job.status === "timed_out_waiting") {
    return updateImageGenerationJob(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorCode: "TIMED_OUT",
      errorMessage: IMAGE_ERROR_USER_MESSAGE.TIMED_OUT,
      estimatedPercent: 100,
    });
  }
  return job;
}

/**
 * Re-link design_item media without calling 3080 again.
 */
export async function retryDesignItemJobSave(
  jobId: string,
): Promise<
  | { ok: true; job: ImageGenerationJob }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      job: ImageGenerationJob | null;
    }
> {
  const job = await readImageGenerationJob(jobId);
  if (!job) {
    return {
      ok: false,
      status: 404,
      code: "JOB_NOT_FOUND",
      message: IMAGE_ERROR_USER_MESSAGE.JOB_NOT_FOUND,
      job: null,
    };
  }
  if (job.status !== "save_failed") {
    return {
      ok: false,
      status: 409,
      code: "RETRY_NOT_ALLOWED",
      message: IMAGE_ERROR_USER_MESSAGE.RETRY_NOT_ALLOWED,
      job,
    };
  }
  if (!job.primaryMediaId || job.mediaIds.length === 0) {
    return {
      ok: false,
      status: 409,
      code: "SAVE_FAILED",
      message: "缺少已生成媒体，无法仅重试保存",
      job,
    };
  }

  if (job.subjectKind === "design_item") {
    const linked = await linkDesignItemJobResult(job);
    if (!linked.ok) {
      const next = await updateImageGenerationJob(jobId, {
        status: "save_failed",
        saveErrorMessage: linked.message,
        errorCode: "SAVE_FAILED",
        errorMessage: IMAGE_ERROR_USER_MESSAGE.SAVE_FAILED,
      });
      return {
        ok: false,
        status: 500,
        code: "SAVE_FAILED",
        message: linked.message,
        job: next,
      };
    }
    const next = await updateImageGenerationJob(jobId, {
      status: "succeeded",
      savedToLibrary: true,
      saveErrorMessage: null,
      errorCode: null,
      errorMessage: null,
      resultClaimed: true,
    });
    await maybeNotify(next);
    return { ok: true, job: next };
  }

  // Library subjects: client completes save via /media/save then mark-saved.
  return {
    ok: false,
    status: 409,
    code: "RETRY_NOT_ALLOWED",
    message: "请使用资产库保存入口重新入库",
    job,
  };
}

export { DEFAULT_WAIT_MS, EXTEND_WAIT_MS };
