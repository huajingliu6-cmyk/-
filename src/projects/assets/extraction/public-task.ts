import type {
  AssetExtractionTask,
  PublicAssetExtractionTask,
  PublicAssetRosterItem,
} from "@/projects/assets/extraction/types";
import {
  isAwaitingRosterSelectionStatus,
  isCompletedExtractionStatus,
  isLiveExtractionStatus,
} from "@/projects/assets/extraction/types";
import { ASSET_EXTRACTION_POLICY } from "@/projects/assets/extraction/asset-extraction-policy";
import { buildAssetExtractionProgress } from "@/projects/assets/extraction/progress-view";

function isPublicRunnerStale(task: AssetExtractionTask, nowMs = Date.now()): boolean {
  if (!isLiveExtractionStatus(task.status)) return false;
  const stamp = task.heartbeatAt?.trim() || task.updatedAt?.trim();
  if (!stamp) return true;
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) return true;
  return nowMs - ms > ASSET_EXTRACTION_POLICY.runnerStaleMs;
}

/** User/API view of a task: never includes terminal_failed diagnostics. */
export function toPublicExtractionTask(
  task: AssetExtractionTask,
  options?: { roster?: PublicAssetRosterItem[] },
): PublicAssetExtractionTask {
  const failed = task.status === "failed";
  const completed = isCompletedExtractionStatus(task.status);
  const awaiting = isAwaitingRosterSelectionStatus(task.status);
  const progress =
    task.progress ??
    buildAssetExtractionProgress(task, {
      rosterChunksTotal: task.rosterChunksTotal,
    });
  const estimatedProgress = completed
    ? 100
    : Math.max(0, Math.min(99, progress.estimatedProgress));
  const annotatedRoster =
    options?.roster ??
    (awaiting && (task.roster?.length ?? 0) > 0
      ? task.roster!.map((item) => ({
          ...item,
          matchStatus: "new" as const,
          matchedAssetName: null,
          selectable: true,
          defaultSelected: true,
        }))
      : undefined);
  const runnerStale = isPublicRunnerStale(task);

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
    estimatedProgress:
      completed
        ? 100
        : isLiveExtractionStatus(task.status)
          ? estimatedProgress
          : estimatedProgress,
    revision: task.revision,
    errorMessage: failed ? task.errorMessage : null,
    versionId: task.versionId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    heartbeatAt: task.heartbeatAt ?? null,
    runnerStale: runnerStale || undefined,
    progress: completed
      ? {
          ...progress,
          phase: "completed",
          estimatedProgress: 100,
        }
      : progress,
    ...(annotatedRoster && annotatedRoster.length > 0
      ? { roster: annotatedRoster }
      : {}),
  };
}
