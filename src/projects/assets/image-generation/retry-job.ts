import "server-only";

import {
  releaseGenerationCredits,
  reserveImageGenerationCredits,
} from "@/credits/generation-billing";
import type { AssetBundleStoreScope } from "@/projects/assets/asset-bundle-scope";
import { createAndEnqueueImageJob } from "@/projects/assets/image-generation/process-job";
import {
  readImageGenerationJob,
  updateImageGenerationJob,
} from "@/projects/assets/image-generation/store";
import { assertRetrySnapshotComplete } from "@/projects/assets/image-generation/retry-snapshot";
import {
  loadReferenceImagesFromStorageKeys,
  writeTempReferenceImage,
} from "@/projects/assets/image-generation/temp-reference-storage";
import {
  IMAGE_ERROR_USER_MESSAGE,
  IMAGE_JOB_ACTIVE_STATUSES,
  type ImageGenerationJob,
} from "@/projects/assets/image-generation/types";
import type { ProjectAssetImageMime } from "@/projects/assets/asset-image-constants";
import {
  sniffProjectAssetImageMime,
  normalizeDeclaredImageMime,
} from "@/projects/assets/asset-image-storage";

/**
 * Retry using server-persisted snapshot only — does not trust client params.
 */
export async function retryImageJobFromSnapshot(input: {
  projectId: string;
  scope: AssetBundleStoreScope;
  jobId: string;
  actorUserId: string;
}): Promise<
  | { ok: true; job: ImageGenerationJob }
  | { ok: false; status: number; code: string; message: string; job?: ImageGenerationJob }
> {
  const prior = await readImageGenerationJob(input.jobId);
  if (
    !prior ||
    prior.projectId !== input.projectId ||
    prior.scope !== input.scope
  ) {
    return {
      ok: false,
      status: 404,
      code: "JOB_NOT_FOUND",
      message: IMAGE_ERROR_USER_MESSAGE.JOB_NOT_FOUND,
    };
  }

  if (IMAGE_JOB_ACTIVE_STATUSES.includes(prior.status)) {
    return {
      ok: false,
      status: 409,
      code: "GENERATION_IN_PROGRESS",
      message: IMAGE_ERROR_USER_MESSAGE.GENERATION_IN_PROGRESS,
      job: prior,
    };
  }

  if (prior.status !== "failed" && prior.status !== "save_failed") {
    return {
      ok: false,
      status: 409,
      code: "RETRY_NOT_ALLOWED",
      message: IMAGE_ERROR_USER_MESSAGE.RETRY_NOT_ALLOWED,
      job: prior,
    };
  }

  if (
    prior.errorCode === "INVALID_PARAMS" ||
    prior.errorCode === "REFERENCE_IMAGE_REQUIRED"
  ) {
    return {
      ok: false,
      status: 409,
      code: prior.errorCode,
      message:
        prior.errorMessage ??
        IMAGE_ERROR_USER_MESSAGE[prior.errorCode],
      job: prior,
    };
  }

  const parsed = assertRetrySnapshotComplete(prior.params.retrySnapshot);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 409,
      code: parsed.code,
      message: parsed.message,
      job: prior,
    };
  }
  const snapshot = parsed.snapshot;

  const allKeys = [
    ...snapshot.referenceStorageKeys,
    ...snapshot.libraryReferenceMediaIds,
  ];
  if (snapshot.mode === "image_to_image" && allKeys.length === 0) {
    return {
      ok: false,
      status: 409,
      code: "REFERENCE_IMAGE_REQUIRED",
      message: IMAGE_ERROR_USER_MESSAGE.REFERENCE_IMAGE_REQUIRED,
      job: prior,
    };
  }

  const loaded = await loadReferenceImagesFromStorageKeys({
    projectId: input.projectId,
    keys: allKeys,
  });
  if (!loaded.ok) {
    // Stamp prior so UI can show replace-reference entry
    await updateImageGenerationJob(prior.id, {
      errorCode: "REFERENCE_IMAGE_REQUIRED",
      errorMessage: loaded.message,
      errorFields: ["referenceImages"],
    });
    return {
      ok: false,
      status: 409,
      code: loaded.code,
      message: loaded.message,
      job: (await readImageGenerationJob(prior.id)) ?? prior,
    };
  }

  const reserved = await reserveImageGenerationCredits({
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    itemKey: `library:${prior.subjectId}`,
    idempotencyKey: `retry:${prior.id}:${Date.now()}`,
    generatedMedia: null,
    count: snapshot.count ?? 1,
  });
  if (!reserved.ok) {
    return {
      ok: false,
      status: 402,
      code: "INSUFFICIENT_CREDITS",
      message: IMAGE_ERROR_USER_MESSAGE.INSUFFICIENT_CREDITS,
      job: prior,
    };
  }

  const enqueued = await createAndEnqueueImageJob({
    projectId: input.projectId,
    scope: input.scope,
    subjectKind: prior.subjectKind,
    subjectId: prior.subjectId,
    assetKind: prior.assetKind,
    episodeId: prior.episodeId,
    actorUserId: input.actorUserId,
    params: {
      prompt: snapshot.prompt,
      mode: snapshot.mode,
      model: snapshot.model ?? undefined,
      quality: snapshot.quality ?? undefined,
      aspectRatio: snapshot.aspectRatio ?? undefined,
      count: snapshot.count ?? undefined,
      multiAngleMode: snapshot.multiAngleMode,
      sceneCharacterPlacementsJson: snapshot.sceneCharacterPlacementsJson,
      referenceMediaIds: snapshot.libraryReferenceMediaIds,
      retrySnapshot: snapshot,
    },
    idempotencyKey: null,
    creditReservationId: reserved.reservationId,
    referenceImages: loaded.images,
    effectivePrompt: snapshot.effectivePrompt,
    model: snapshot.model ?? undefined,
    sourceEntry: snapshot.sourceEntry,
    // Refs already persisted — skip re-write
    skipPersistReferences: true,
  });

  if (!enqueued.ok) {
    await releaseGenerationCredits({
      reservationId: reserved.reservationId,
      projectId: input.projectId,
      reason: "image-job-retry-blocked",
    }).catch(() => undefined);
    return {
      ok: false,
      status: enqueued.status,
      code: enqueued.code,
      message: enqueued.message,
      job: enqueued.job,
    };
  }

  return { ok: true, job: enqueued.job };
}

/**
 * Replace only reference storage keys on a failed job; keep prompt/params.
 */
export async function replaceImageJobReferences(input: {
  projectId: string;
  scope: AssetBundleStoreScope;
  jobId: string;
  files: Array<{ buffer: Buffer; mimeType?: string; fileName?: string }>;
}): Promise<
  | { ok: true; job: ImageGenerationJob }
  | { ok: false; status: number; code: string; message: string }
> {
  const job = await readImageGenerationJob(input.jobId);
  if (
    !job ||
    job.projectId !== input.projectId ||
    job.scope !== input.scope
  ) {
    return {
      ok: false,
      status: 404,
      code: "JOB_NOT_FOUND",
      message: IMAGE_ERROR_USER_MESSAGE.JOB_NOT_FOUND,
    };
  }
  if (IMAGE_JOB_ACTIVE_STATUSES.includes(job.status)) {
    return {
      ok: false,
      status: 409,
      code: "RETRY_NOT_ALLOWED",
      message: "任务进行中，不能替换参考图。",
    };
  }

  const parsed = assertRetrySnapshotComplete(job.params.retrySnapshot);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 409,
      code: parsed.code,
      message: parsed.message,
    };
  }

  if (!input.files.length) {
    return {
      ok: false,
      status: 400,
      code: "REFERENCE_IMAGE_REQUIRED",
      message: IMAGE_ERROR_USER_MESSAGE.REFERENCE_IMAGE_REQUIRED,
    };
  }

  const projectedBytes = input.files.reduce(
    (sum, file) => sum + file.buffer.byteLength,
    0,
  );
  const { assertTempReferenceQuotaAllows } = await import(
    "@/projects/assets/image-generation/temp-reference-quota"
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

  const keys: string[] = [];
  for (const file of input.files) {
    const sniffed =
      sniffProjectAssetImageMime(file.buffer) ||
      normalizeDeclaredImageMime(file.mimeType);
    if (!sniffed) {
      return {
        ok: false,
        status: 400,
        code: "REFERENCE_IMAGE_REQUIRED",
        message: IMAGE_ERROR_USER_MESSAGE.REFERENCE_IMAGE_REQUIRED,
      };
    }
    const meta = await writeTempReferenceImage({
      projectId: input.projectId,
      buffer: file.buffer,
      mimeType: sniffed as ProjectAssetImageMime,
      fileName: file.fileName ?? null,
    });
    keys.push(meta.storageKey);
  }

  const nextSnapshot = {
    ...parsed.snapshot,
    referenceStorageKeys: keys,
    libraryReferenceMediaIds: [],
  };

  const next = await updateImageGenerationJob(job.id, {
    params: {
      ...job.params,
      retrySnapshot: nextSnapshot,
      referenceMediaIds: [],
    },
    errorCode: null,
    errorMessage: null,
    errorFields: [],
  });

  return { ok: true, job: next };
}
