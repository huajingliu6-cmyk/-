import type {
  AssetExtractionTask,
  PublicAssetExtractionTask,
} from "@/projects/assets/extraction/types";
import {
  isCompletedExtractionStatus,
  isLiveExtractionStatus,
} from "@/projects/assets/extraction/types";
import { buildAssetExtractionProgress } from "@/projects/assets/extraction/progress-view";

/** User/API view of a task: never includes terminal_failed diagnostics. */
export function toPublicExtractionTask(
  task: AssetExtractionTask,
): PublicAssetExtractionTask {
  const failed = task.status === "failed";
  const completed = isCompletedExtractionStatus(task.status);
  const progress =
    task.progress ??
    buildAssetExtractionProgress(task, {
      rosterChunksTotal: task.rosterChunksTotal,
    });
  const estimatedProgress = completed
    ? 100
    : Math.max(0, Math.min(99, progress.estimatedProgress));
  return {
    id: task.id,
    projectId: task.projectId,
    taskKey: task.taskKey,
    sourceFingerprint: task.sourceFingerprint,
    scope: task.scope,
    episodeId: task.episodeId,
    modelKey: task.modelKey,
    status: completed ? "completed" : task.status,
    stage: completed ? "complete" : task.stage,
    estimatedProgress: completed
      ? 100
      : isLiveExtractionStatus(task.status)
        ? estimatedProgress
        : estimatedProgress,
    revision: task.revision,
    errorMessage: failed ? task.errorMessage : null,
    versionId: task.versionId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    progress: completed
      ? {
          ...progress,
          phase: "completed",
          estimatedProgress: 100,
        }
      : progress,
    ...(task.status === "awaiting_roster_selection" && (task.roster?.length ?? 0) > 0
      ? { roster: task.roster }
      : {}),
  };
}
