import { dispatchAssetExtractionRunner } from "@/projects/assets/extraction/run-task";
import { detailItemsFromRoster } from "@/projects/assets/extraction/pipeline/details";
import { computeExtractionProgress } from "@/projects/assets/extraction/pipeline/progress";
import { annotateRosterForSelection } from "@/projects/assets/extraction/roster-selection";
import { mergedActiveAssets } from "@/projects/assets/extraction/materialize";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  getLatestTask,
  mutateAssetExtractionStore,
  loadAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import type {
  AssetExtractionProgress,
  AssetExtractionTask,
  AssetRosterItem,
} from "@/projects/assets/extraction/types";
import { isLiveExtractionStatus } from "@/projects/assets/extraction/types";

export type ConfirmEpisodeRosterResult =
  | { ok: true; task: AssetExtractionTask }
  | { ok: false; code: string; message: string };

function filterRosterByKeys(
  roster: AssetRosterItem[],
  selectedAssetKeys: string[],
): AssetRosterItem[] {
  const keySet = new Set(selectedAssetKeys);
  return roster.filter((item) => keySet.has(item.assetKey));
}

export async function confirmEpisodeRosterSelection(input: {
  projectId: string;
  taskId: string;
  selectedAssetKeys: string[];
}): Promise<ConfirmEpisodeRosterResult> {
  const selected = [
    ...new Set(
      input.selectedAssetKeys
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
  if (selected.length === 0) {
    return {
      ok: false,
      code: "EMPTY_SELECTION",
      message: "请至少选择一个资产",
    };
  }

  const store = await loadAssetExtractionStore(input.projectId);
  const taskBefore = store.tasks.find((item) => item.id === input.taskId);
  if (!taskBefore) {
    return { ok: false, code: "TASK_NOT_FOUND", message: "提取任务不存在" };
  }
  if (taskBefore.status !== "awaiting_roster_selection") {
    return {
      ok: false,
      code: "INVALID_TASK_STATUS",
      message: "当前任务不在待选择状态",
    };
  }
  if (taskBefore.scope !== "episode" || !taskBefore.episodeId) {
    return {
      ok: false,
      code: "INVALID_TASK_SCOPE",
      message: "仅单集提取支持资产名单选择",
    };
  }

  const roster = taskBefore.roster ?? [];
  const invalid = selected.filter(
    (key) => !roster.some((item) => item.assetKey === key),
  );
  if (invalid.length > 0) {
    return {
      ok: false,
      code: "INVALID_SELECTION",
      message: "所选资产不在提取名单中",
    };
  }

  const libraryBundle = await loadAssetBundleDraft(input.projectId);
  const annotated = annotateRosterForSelection(roster, {
    extractedAssets: mergedActiveAssets(store),
    libraryBundle,
  });
  const existingSelected = selected.filter((key) => {
    const row = annotated.find((item) => item.assetKey === key);
    return row?.matchStatus === "existing";
  });
  if (existingSelected.length > 0) {
    const names = existingSelected
      .map(
        (key) =>
          annotated.find((item) => item.assetKey === key)?.name ?? key,
      )
      .join("、");
    return {
      ok: false,
      code: "EXISTING_ASSET_SELECTED",
      message: `以下资产已存在于资产库，不能重复设计：${names}`,
    };
  }

  let confirmedTask: AssetExtractionTask | undefined;
  const saved = await mutateAssetExtractionStore(input.projectId, (nextStore) => {
    const task = nextStore.tasks.find((item) => item.id === input.taskId) ?? null;
    if (!task) {
      return nextStore;
    }
    if (task.status !== "awaiting_roster_selection") {
      return nextStore;
    }
    if (task.scope !== "episode" || !task.episodeId) {
      return nextStore;
    }
    const currentRoster = task.roster ?? [];
    const filtered = filterRosterByKeys(currentRoster, selected);
    if (filtered.length === 0) {
      return nextStore;
    }
    const stillInvalid = selected.filter(
      (key) => !currentRoster.some((item) => item.assetKey === key),
    );
    if (stillInvalid.length > 0) {
      return nextStore;
    }

    const detailItems = detailItemsFromRoster(filtered, task.detailItems);
    const rosterChunksTotal = Math.max(1, task.rosterChunksTotal ?? 1);
    const progress: AssetExtractionProgress = {
      phase: "extracting_details",
      estimatedProgress: computeExtractionProgress({
        stage: "extracting_details",
        rosterChunksCompleted: rosterChunksTotal,
        rosterChunksTotal,
        detailsCompleted: 0,
        detailsTotal: filtered.length,
      }),
      roster: {
        scannedChunks: rosterChunksTotal,
        totalChunks: rosterChunksTotal,
        discoveredCount: currentRoster.length,
      },
      details: {
        totalAssets: filtered.length,
        completedAssets: 0,
        runningBatches: 0,
        completedBatches: 0,
        totalBatches: Math.ceil(filtered.length / 5),
        retryRound: 0,
      },
    };

    const updated: AssetExtractionTask = {
      ...task,
      status: "extracting_details",
      stage: "extracting_details",
      roster: filtered,
      selectedAssetKeys: selected,
      detailItems,
      failedAssetQueue: [],
      estimatedProgress: progress.estimatedProgress,
      progress,
      revision: task.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    confirmedTask = updated;
    return {
      ...nextStore,
      tasks: nextStore.tasks.map((item) =>
        item.id === task.id ? updated : item,
      ),
    };
  });

  if (!confirmedTask) {
    const latest = getLatestTask(saved, undefined);
    const task = saved.tasks.find((item) => item.id === input.taskId);
    if (!task) {
      return { ok: false, code: "TASK_NOT_FOUND", message: "提取任务不存在" };
    }
    if (task.status !== "awaiting_roster_selection") {
      return {
        ok: false,
        code: "INVALID_TASK_STATUS",
        message: "当前任务不在待选择状态",
      };
    }
    if (latest && isLiveExtractionStatus(latest.status) && latest.id !== task.id) {
      return {
        ok: false,
        code: "ASSET_EXTRACTION_IN_PROGRESS",
        message: "资产提取尚未完成，请耐心等待。",
      };
    }
    return {
      ok: false,
      code: "CONFIRM_FAILED",
      message: "无法确认资产选择",
    };
  }

  dispatchAssetExtractionRunner(confirmedTask.id, input.projectId);
  return { ok: true, task: confirmedTask };
}
