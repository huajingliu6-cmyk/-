import "server-only";

import {
  listImageGenerationJobs,
  updateImageGenerationJob,
} from "@/projects/assets/image-generation/store";
import {
  IMAGE_ERROR_USER_MESSAGE,
  IMAGE_JOB_ACTIVE_STATUSES,
} from "@/projects/assets/image-generation/types";
import { getImageWorkerInstanceId } from "@/projects/assets/image-generation/worker-instance";

type ShutdownGlobal = typeof globalThis & {
  __infiniteCanvasImageShutdownHooksInstalled?: boolean;
};

/**
 * Mark this process's unfinished image jobs as PROCESS_SHUTDOWN.
 * Must stay fast — no waiting on 3080, no long I/O beyond JSON updates.
 */
export async function markLocalImageJobsProcessShutdown(): Promise<number> {
  const workerId = getImageWorkerInstanceId();
  const jobs = await listImageGenerationJobs();
  let n = 0;
  for (const job of jobs) {
    if (job.workerInstanceId !== workerId) continue;
    if (!IMAGE_JOB_ACTIVE_STATUSES.includes(job.status)) continue;
    if (job.status === "saving" && (job.primaryMediaId || job.mediaIds.length)) {
      await updateImageGenerationJob(job.id, {
        status: "save_failed",
        completedAt: new Date().toISOString(),
        errorCode: "PROCESS_SHUTDOWN",
        errorMessage: IMAGE_ERROR_USER_MESSAGE.PROCESS_SHUTDOWN,
        saveErrorMessage:
          "生成服务正常退出，图片已生成但未完成入库，可重新保存到资产库。",
        estimatedPercent: 100,
        creditReservationId: null,
      });
    } else {
      await updateImageGenerationJob(job.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorCode: "PROCESS_SHUTDOWN",
        errorMessage: IMAGE_ERROR_USER_MESSAGE.PROCESS_SHUTDOWN,
        estimatedPercent: 100,
        creditReservationId: null,
      });
    }
    n += 1;
  }
  return n;
}

export function installImageJobGracefulShutdownHooks(): void {
  const g = globalThis as ShutdownGlobal;
  if (g.__infiniteCanvasImageShutdownHooksInstalled) return;
  g.__infiniteCanvasImageShutdownHooksInstalled = true;

  const run = () => {
    void markLocalImageJobsProcessShutdown().catch((error) => {
      console.error("[image-job] graceful shutdown mark failed:", error);
    });
  };

  process.once("SIGTERM", run);
  process.once("SIGINT", run);
  process.once("beforeExit", run);
}
