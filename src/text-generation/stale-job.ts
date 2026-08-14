import { releaseReservation } from "@/text-generation/credits";
import { resolveTimeoutMsForOutputKind } from "@/text-generation/generation-abort";
import { saveTextJob } from "@/text-generation/job-store";
import type { TextGenerationJob } from "@/text-generation/types";

/** Extra grace so an in-flight timeout handler can finish writing job status. */
export const STALE_JOB_GRACE_MS = 15_000;

export function isStaleTextJob(
  job: Pick<TextGenerationJob, "status" | "updatedAt" | "outputKind">,
  nowMs = Date.now(),
  timeoutMs = resolveTimeoutMsForOutputKind(job.outputKind),
): boolean {
  if (job.status !== "queued" && job.status !== "running") return false;
  const updatedAtMs = Date.parse(job.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return true;
  return nowMs - updatedAtMs > timeoutMs + STALE_JOB_GRACE_MS;
}

/**
 * Mark an abandoned queued/running job failed and release its credit hold.
 * Safe to call when the process restarted and the in-memory AbortController is gone.
 */
export async function reclaimStaleTextJob(
  job: TextGenerationJob,
): Promise<TextGenerationJob> {
  const next: TextGenerationJob = {
    ...job,
    status: "failed",
    errorCode: "STALE_JOB",
    errorMessage: "生成任务已超时中断，请重试",
    updatedAt: new Date().toISOString(),
  };
  await saveTextJob(next);
  await releaseReservation({
    generationId: job.generationId,
    projectId: job.projectId,
    reason: "text-generation-stale",
  });
  return next;
}
