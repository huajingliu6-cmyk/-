import "server-only";

import { dispatchAssetExtractionRunner } from "@/projects/assets/extraction/run-task";
import { isRunnerLeaseActive } from "@/projects/assets/extraction/runner-lease";
import {
  getOpenOrLatestExtractionTask,
  loadAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import { isLiveExtractionStatus } from "@/projects/assets/extraction/types";
import type { AssetExtractionTask } from "@/projects/assets/extraction/types";

export type ResumeLiveAssetExtractionResult =
  | {
      ok: true;
      resumed: boolean;
      task: AssetExtractionTask | null;
      reason?: string;
    }
  | { ok: false; message: string };

/**
 * If the latest project task is still live but has no valid runner lease
 * (typical after web rebuild), re-dispatch the same taskId.
 * Lease claim happens inside the runner so GET polls cannot orphan a lease.
 */
export async function resumeLiveAssetExtractionTask(
  projectId: string,
): Promise<ResumeLiveAssetExtractionResult> {
  try {
    const store = await loadAssetExtractionStore(projectId);
    const task = getOpenOrLatestExtractionTask(store);
    if (!task) {
      return { ok: true, resumed: false, task: null, reason: "NO_TASK" };
    }
    if (!isLiveExtractionStatus(task.status)) {
      return { ok: true, resumed: false, task, reason: "NOT_LIVE" };
    }
    if (isRunnerLeaseActive(task)) {
      return { ok: true, resumed: false, task, reason: "LEASE_ACTIVE" };
    }

    dispatchAssetExtractionRunner(task.id, projectId);
    return {
      ok: true,
      resumed: true,
      task,
      reason: "DISPATCHED",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "无法恢复提取任务",
    };
  }
}
