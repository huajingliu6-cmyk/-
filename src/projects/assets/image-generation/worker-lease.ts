import "server-only";

import { randomUUID } from "crypto";
import {
  readImageGenerationJob,
  updateImageGenerationJob,
} from "@/projects/assets/image-generation/store";
import {
  IMAGE_ERROR_USER_MESSAGE,
  IMAGE_JOB_TERMINAL_STATUSES,
  type ImageGenerationJob,
  type ImageGenerationJobStatus,
} from "@/projects/assets/image-generation/types";
import { getImageWorkerInstanceId } from "@/projects/assets/image-generation/worker-instance";

export function createImageJobLeaseToken(): string {
  return `lease_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export async function touchImageJobHeartbeat(
  jobId: string,
  leaseToken: string,
): Promise<ImageGenerationJob | null> {
  const job = await readImageGenerationJob(jobId);
  if (!job) return null;
  if (job.leaseToken && job.leaseToken !== leaseToken) return null;
  if (job.workerInstanceId && job.workerInstanceId !== getImageWorkerInstanceId()) {
    return null;
  }
  return updateImageGenerationJob(jobId, {
    heartbeatAt: new Date().toISOString(),
  });
}

/**
 * Apply a terminal/result patch only if this worker still holds the lease
 * and the job is not already terminal (or same terminal idempotent claim).
 */
export async function applyImageJobOwnedPatch(
  jobId: string,
  leaseToken: string,
  patch: Partial<ImageGenerationJob>,
): Promise<
  | { ok: true; job: ImageGenerationJob }
  | { ok: false; code: "LEASE_MISMATCH" | "ALREADY_TERMINAL"; job: ImageGenerationJob | null }
> {
  const job = await readImageGenerationJob(jobId);
  if (!job) return { ok: false, code: "LEASE_MISMATCH", job: null };
  if (job.leaseToken && job.leaseToken !== leaseToken) {
    return { ok: false, code: "LEASE_MISMATCH", job };
  }
  if (
    job.workerInstanceId &&
    job.workerInstanceId !== getImageWorkerInstanceId()
  ) {
    return { ok: false, code: "LEASE_MISMATCH", job };
  }

  const nextStatus = patch.status as ImageGenerationJobStatus | undefined;
  if (
    IMAGE_JOB_TERMINAL_STATUSES.includes(job.status) &&
    nextStatus &&
    nextStatus !== job.status
  ) {
    return { ok: false, code: "ALREADY_TERMINAL", job };
  }
  if (job.resultClaimed && patch.resultClaimed === true) {
    return { ok: false, code: "ALREADY_TERMINAL", job };
  }

  const next = await updateImageGenerationJob(jobId, {
    ...patch,
    heartbeatAt: new Date().toISOString(),
  });
  return { ok: true, job: next };
}

export function leaseMismatchMessage(): string {
  return IMAGE_ERROR_USER_MESSAGE.LEASE_MISMATCH;
}
