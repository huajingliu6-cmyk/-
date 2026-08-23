import "server-only";

import { createNotification } from "@/notifications/store";
import {
  listImageGenerationJobs,
  updateImageGenerationJob,
} from "@/projects/assets/image-generation/store";
import {
  IMAGE_ERROR_USER_MESSAGE,
  IMAGE_JOB_ACTIVE_STATUSES,
  type ImageGenerationJob,
} from "@/projects/assets/image-generation/types";
import { getImageWorkerInstanceId } from "@/projects/assets/image-generation/worker-instance";
import type { AssetBundleStoreScope } from "@/projects/assets/asset-bundle-scope";

/**
 * On project open / jobs list: mark stale active jobs from a previous process.
 * Idempotent — already-recovered jobs are left unchanged.
 * Does not scan other projects. Does not auto-call 3080.
 *
 * Platform note: 3080 OpenAI-compatible image APIs are sync-only and do not
 * expose providerTaskId / poll endpoints, so stale jobs cannot be reclaimed
 * from upstream — they are marked PROCESS_RESTARTED for manual retry.
 */
export async function recoverStaleImageJobsForProject(input: {
  projectId: string;
  scope: AssetBundleStoreScope;
}): Promise<{
  recovered: ImageGenerationJob[];
  interrupted: ImageGenerationJob[];
}> {
  const currentWorker = getImageWorkerInstanceId();
  const jobs = await listImageGenerationJobs({
    projectId: input.projectId,
    scope: input.scope,
  });
  const recovered: ImageGenerationJob[] = [];
  const interrupted: ImageGenerationJob[] = [];

  for (const job of jobs) {
    if (
      (job.errorCode === "PROCESS_RESTARTED" ||
        job.errorCode === "PROCESS_SHUTDOWN") &&
      (job.status === "failed" || job.status === "save_failed")
    ) {
      interrupted.push(job);
      continue;
    }

    const isActive = IMAGE_JOB_ACTIVE_STATUSES.includes(job.status);
    if (!isActive) continue;

    // Current process still owns this job — leave it alone.
    if (job.workerInstanceId && job.workerInstanceId === currentWorker) {
      continue;
    }

    if (job.status === "saving") {
      const hasResult =
        Boolean(job.primaryMediaId) || job.mediaIds.length > 0;
      if (hasResult) {
        const next = await updateImageGenerationJob(job.id, {
          status: "save_failed",
          completedAt: new Date().toISOString(),
          errorCode: "PROCESS_RESTARTED",
          errorMessage: IMAGE_ERROR_USER_MESSAGE.PROCESS_RESTARTED,
          saveErrorMessage:
            "生成服务中断，图片已生成但未完成入库，可重新保存到资产库。",
          estimatedPercent: 100,
          creditReservationId: null,
        });
        await notifyRestartOnce(next);
        recovered.push(next);
        interrupted.push(next);
        continue;
      }
    }

    if (
      job.status === "queued" ||
      job.status === "running" ||
      job.status === "timed_out_waiting" ||
      job.status === "saving"
    ) {
      const next = await updateImageGenerationJob(job.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorCode: "PROCESS_RESTARTED",
        errorMessage: IMAGE_ERROR_USER_MESSAGE.PROCESS_RESTARTED,
        estimatedPercent: 100,
        creditReservationId: null,
      });
      await notifyRestartOnce(next);
      recovered.push(next);
      interrupted.push(next);
    }
  }

  return { recovered, interrupted };
}

async function notifyRestartOnce(job: ImageGenerationJob): Promise<void> {
  if (job.notificationSent) return;
  try {
    await createNotification({
      recipientUserId: job.actorUserId,
      type: "image_generation_failed",
      projectId: job.projectId,
      episodeId: job.episodeId ?? "",
      submissionId: job.id,
      submitterUserId: job.actorUserId,
      title: "生成任务已中断",
      summary: IMAGE_ERROR_USER_MESSAGE.PROCESS_RESTARTED,
      dedupeBySubmissionId: true,
    });
    await updateImageGenerationJob(job.id, { notificationSent: true });
  } catch (error) {
    console.error(`[image-job] restart notify failed ${job.id}:`, error);
  }
}
