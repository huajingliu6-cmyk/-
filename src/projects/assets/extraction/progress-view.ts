import { ASSET_DETAIL_BATCH_SIZE } from "@/projects/assets/extraction/pipeline/constants";
import { computeExtractionProgress } from "@/projects/assets/extraction/pipeline/progress";
import type {
  AssetExtractionProgress,
  AssetExtractionProgressPhase,
  AssetExtractionStage,
  AssetExtractionTask,
} from "@/projects/assets/extraction/types";

export function progressPhaseFromStage(
  stage: AssetExtractionStage,
): AssetExtractionProgressPhase {
  if (stage === "complete") return "completed";
  return stage;
}

export function stageFromProgressPhase(
  phase: AssetExtractionProgressPhase,
): AssetExtractionStage {
  if (phase === "completed") return "complete";
  return phase;
}

export function subtitleForProgressPhase(
  phase: AssetExtractionProgressPhase,
): string {
  switch (phase) {
    case "discovering_roster":
      return "正在扫描剧本中的角色资产";
    case "merging_roster":
      return "正在整理角色资产名单";
    case "extracting_details":
      return "正在生成角色外观详情";
    case "retrying_failed_once":
      return "正在补全未完成的资产";
    case "saving":
      return "正在保存资产结果";
    case "completed":
      return "资产提取已完成";
    default:
      return "正在提取资产";
  }
}

export function footerLinesForProgress(
  progress: AssetExtractionProgress,
): string[] {
  const lines: string[] = [];
  if (
    progress.phase === "extracting_details" ||
    progress.phase === "retrying_failed_once"
  ) {
    lines.push("正在按每批最多 5 个角色生成外观详情");
    lines.push("当前最多 3 路任务同时处理");
  } else if (progress.phase === "discovering_roster") {
    lines.push("正在扫描剧本分块并发现资产名单");
  } else if (progress.phase === "merging_roster") {
    lines.push("正在合并别名并去重资产名单");
  } else if (progress.phase === "saving") {
    lines.push("正在将结果写入资产库");
  }
  lines.push("结果会在完成后自动进入资产页");
  return lines;
}

function countCompletedBatches(detailItems: AssetExtractionTask["detailItems"]): {
  completedBatches: number;
  totalBatches: number;
  runningBatches: number;
} {
  const items = detailItems ?? [];
  const totalAssets = items.length;
  const totalBatches =
    totalAssets > 0 ? Math.ceil(totalAssets / ASSET_DETAIL_BATCH_SIZE) : 0;
  const batchIndexes = new Set(
    items
      .map((item) => item.batchIndex)
      .filter((value): value is number => typeof value === "number" && value > 0),
  );
  const completedBatches = batchIndexes.size;
  const runningBatches = items.some((item) => item.status === "running")
    ? Math.min(3, Math.max(1, totalBatches - completedBatches))
    : 0;
  return { completedBatches, totalBatches, runningBatches };
}

/** Build progress snapshot from persisted task fields (refresh-safe). */
export function buildAssetExtractionProgress(
  task: AssetExtractionTask,
  options?: {
    rosterChunksTotal?: number;
    runningBatches?: number;
    completedBatches?: number;
    totalBatches?: number;
    retryRound?: 0 | 1;
  },
): AssetExtractionProgress {
  const phase = progressPhaseFromStage(task.stage);
  const rosterItems = task.roster ?? [];
  const detailItems = task.detailItems ?? [];
  const scannedChunks = (task.rosterCompletedChunkIds ?? []).length;
  const totalChunks = Math.max(
    options?.rosterChunksTotal ?? scannedChunks,
    scannedChunks,
    1,
  );
  const completedAssets = detailItems.filter(
    (item) => item.status === "completed",
  ).length;
  const totalAssets =
    detailItems.length > 0 ? detailItems.length : rosterItems.length;
  const batchStats = countCompletedBatches(detailItems);
  const completedBatches =
    options?.completedBatches ?? batchStats.completedBatches;
  const totalBatches =
    options?.totalBatches ??
    (batchStats.totalBatches > 0
      ? batchStats.totalBatches
      : totalAssets > 0
        ? Math.ceil(totalAssets / ASSET_DETAIL_BATCH_SIZE)
        : 0);
  const runningBatches = options?.runningBatches ?? batchStats.runningBatches;
  const retryRound =
    options?.retryRound ??
    (phase === "retrying_failed_once" ? (1 as const) : (0 as const));

  const estimatedProgress =
    phase === "completed"
      ? 100
      : phase === "saving"
        ? 98
        : phase === "merging_roster"
          ? 15
          : computeExtractionProgress({
              stage:
                phase === "discovering_roster"
                  ? "discovering_roster"
                  : phase === "extracting_details"
                    ? "extracting_details"
                    : "retrying_failed_once",
              rosterChunksCompleted: scannedChunks,
              rosterChunksTotal: totalChunks,
              detailsCompleted: completedAssets,
              detailsTotal: Math.max(totalAssets, 1),
            });

  return {
    phase,
    estimatedProgress,
    roster: {
      scannedChunks,
      totalChunks,
      discoveredCount: rosterItems.length,
    },
    details: {
      totalAssets,
      completedAssets,
      runningBatches,
      completedBatches,
      totalBatches,
      retryRound,
    },
  };
}

export function mergeProgressPatch(
  current: AssetExtractionProgress | undefined,
  patch: Partial<AssetExtractionProgress> & {
    roster?: Partial<AssetExtractionProgress["roster"]>;
    details?: Partial<AssetExtractionProgress["details"]>;
  },
): AssetExtractionProgress {
  const base =
    current ??
    ({
      phase: "discovering_roster",
      estimatedProgress: 0,
      roster: { scannedChunks: 0, totalChunks: 1, discoveredCount: 0 },
      details: {
        totalAssets: 0,
        completedAssets: 0,
        runningBatches: 0,
        completedBatches: 0,
        totalBatches: 0,
        retryRound: 0,
      },
    } satisfies AssetExtractionProgress);
  return {
    phase: patch.phase ?? base.phase,
    estimatedProgress: patch.estimatedProgress ?? base.estimatedProgress,
    roster: { ...base.roster, ...(patch.roster ?? {}) },
    details: { ...base.details, ...(patch.details ?? {}) },
  };
}
