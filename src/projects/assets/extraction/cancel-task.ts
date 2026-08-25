import "server-only";

import {
  mutateAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import {
  isLiveExtractionStatus,
  type AssetExtractionTask,
} from "@/projects/assets/extraction/types";

export type CancelAssetExtractionResult =
  | { ok: true; task: AssetExtractionTask }
  | { ok: false; code: string; message: string };

/** Mark a live extraction task failed and clear any runner lease. */
export async function cancelAssetExtractionTask(input: {
  projectId: string;
  taskId: string;
}): Promise<CancelAssetExtractionResult> {
  let cancelled: AssetExtractionTask | null = null;
  let code: string | null = null;

  await mutateAssetExtractionStore(input.projectId, (store) => {
    const task = store.tasks.find((item) => item.id === input.taskId) ?? null;
    if (!task) {
      code = "TASK_NOT_FOUND";
      return store;
    }
    if (!isLiveExtractionStatus(task.status)) {
      code = "NOT_LIVE";
      return store;
    }
    const now = new Date().toISOString();
    const updated: AssetExtractionTask = {
      ...task,
      status: "failed",
      stage: "complete",
      errorMessage: "用户取消了资产提取",
      runnerId: null,
      runnerLeaseUntil: null,
      heartbeatAt: now,
      revision: task.revision + 1,
      updatedAt: now,
    };
    cancelled = updated;
    return {
      ...store,
      tasks: store.tasks.map((item) =>
        item.id === task.id ? updated : item,
      ),
    };
  });

  if (cancelled) {
    return { ok: true, task: cancelled };
  }
  return {
    ok: false,
    code: code ?? "CANCEL_FAILED",
    message:
      code === "TASK_NOT_FOUND"
        ? "任务不存在"
        : code === "NOT_LIVE"
          ? "任务已结束，无需取消"
          : "无法取消提取任务",
  };
}
