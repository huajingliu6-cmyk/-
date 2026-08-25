import { buildScriptAssetChunks } from "@/projects/assets/episode-design/script-asset-chunks";
import { ASSET_EXTRACTION_POLICY } from "@/projects/assets/extraction/asset-extraction-policy";
import { applyCandidateVersion } from "@/projects/assets/extraction/apply-candidate";
import { detectExtractionConflicts } from "@/projects/assets/extraction/conflicts";
import { extractedAssetsToDto } from "@/projects/assets/extraction/from-dto";
import { materializeActiveVersionToBundle, mergedAssetsForVersion } from "@/projects/assets/extraction/materialize";
import { persistEpisodeExtractToDesignRecord } from "@/projects/assets/extraction/persist-episode-design";
import { mergeExtractedAssets, mergeSupplementAssets } from "@/projects/assets/extraction/merge";
import {
  ASSET_DETAIL_BATCH_SIZE,
  ASSET_DETAIL_CONCURRENCY,
} from "@/projects/assets/extraction/pipeline/constants";
import {
  detailItemsFromRoster,
  runAssetDetailBatches,
  type DetailBatchOutcome,
} from "@/projects/assets/extraction/pipeline/details";
import { collectProviderText, mapPool } from "@/projects/assets/extraction/pipeline/pool";
import { computeExtractionProgress } from "@/projects/assets/extraction/pipeline/progress";
import { buildAssetExtractionProgress } from "@/projects/assets/extraction/progress-view";
import {
  buildExtractionPhaseSystemPrompt,
  buildRosterUserPrompt,
} from "@/projects/assets/extraction/pipeline/prompts";
import {
  mergeRosterItems,
  parseRosterOutput,
  scriptAssetChunkBody,
} from "@/projects/assets/extraction/pipeline/roster";
import {
  getActiveVersion,
  getCandidateVersion,
  loadAssetExtractionStore,
  mutateAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import {
  claimAssetExtractionRunnerLease,
  releaseAssetExtractionRunnerLease,
  renewAssetExtractionRunnerLease,
} from "@/projects/assets/extraction/runner-lease";
import { resolveExtractionTextProvider } from "@/projects/assets/extraction/resolve-provider";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import {
  isLiveExtractionStatus,
  type AssetDetailTaskItem,
  type AssetExtractionProgress,
  type AssetExtractionStage,
  type AssetExtractionStore,
  type AssetExtractionTask,
  type AssetRosterItem,
  type ExtractedAsset,
} from "@/projects/assets/extraction/types";

async function patchTask(
  projectId: string,
  taskId: string,
  patch: Partial<AssetExtractionTask>,
): Promise<AssetExtractionStore> {
  return mutateAssetExtractionStore(projectId, (store) => ({
    ...store,
    tasks: store.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            ...patch,
            revision: task.revision + 1,
            updatedAt: new Date().toISOString(),
          }
        : task,
    ),
  }));
}

function currentTask(store: AssetExtractionStore, taskId: string) {
  return store.tasks.find((item) => item.id === taskId) ?? null;
}

function mergeDetailItems(
  current: AssetDetailTaskItem[],
  outcomes: DetailBatchOutcome[],
  asTerminal: boolean,
): AssetDetailTaskItem[] {
  const byKey = new Map(current.map((item) => [item.assetKey, item]));
  for (const outcome of outcomes) {
    const prev = byKey.get(outcome.assetKey);
    byKey.set(outcome.assetKey, {
      assetKey: outcome.assetKey,
      name: outcome.name,
      status: outcome.ok
        ? "completed"
        : asTerminal
          ? "terminal_failed"
          : "failed",
      attempt: (prev?.attempt ?? 0) + 1,
      batchIndex: outcome.batchIndex,
      errorCode: outcome.ok ? undefined : outcome.errorCode,
      errorMessage: outcome.ok ? undefined : outcome.errorMessage,
    });
  }
  return [...byKey.values()];
}

function logTerminalFailed(input: {
  projectId: string;
  taskId: string;
  items: AssetDetailTaskItem[];
}): void {
  for (const item of input.items) {
    if (item.status !== "terminal_failed") continue;
    console.info(
      JSON.stringify({
        event: "ASSET_EXTRACTION_TERMINAL_FAILED",
        projectId: input.projectId,
        taskId: input.taskId,
        assetKey: item.assetKey,
        name: item.name,
        batchIndex: item.batchIndex ?? null,
        attempt: item.attempt,
        errorCode: item.errorCode ?? null,
        errorMessage: item.errorMessage ?? null,
      }),
    );
  }
}

function upsertVersionAssets(input: {
  store: AssetExtractionStore;
  versionId: string;
  scope: AssetExtractionTask["scope"];
  episodeId: string | null;
  assets: ExtractedAsset[];
}): AssetExtractionStore {
  if (input.assets.length === 0) return input.store;
  const existing = input.store.results.find(
    (result) =>
      result.versionId === input.versionId &&
      result.scope === input.scope &&
      result.episodeId === input.episodeId,
  );
  const merged = mergeExtractedAssets([
    existing?.assets ?? [],
    input.assets,
  ]);
  return {
    ...input.store,
    results: [
      ...input.store.results.filter(
        (result) =>
          !(
            result.versionId === input.versionId &&
            result.scope === input.scope &&
            result.episodeId === input.episodeId
          ),
      ),
      {
        versionId: input.versionId,
        scope: input.scope,
        episodeId: input.episodeId,
        assets: merged,
      },
    ],
  };
}

const running = new Set<string>();

export type DispatchAssetExtractionRunnerOptions = {
  runnerId?: string;
};

export function dispatchAssetExtractionRunner(
  taskId: string,
  projectId: string,
  options?: DispatchAssetExtractionRunnerOptions,
): void {
  if (running.has(taskId)) return;
  running.add(taskId);
  void runAssetExtractionTask(taskId, projectId, options).finally(() => {
    running.delete(taskId);
  });
}

export async function runAssetExtractionTask(
  taskId: string,
  projectId: string,
  options?: DispatchAssetExtractionRunnerOptions,
): Promise<void> {
  const initial = await loadAssetExtractionStore(projectId);
  const startTask = currentTask(initial, taskId);
  if (!startTask) return;
  if (!isLiveExtractionStatus(startTask.status)) return;

  const claimed = await claimAssetExtractionRunnerLease({
    projectId,
    taskId,
    runnerId: options?.runnerId?.trim() || undefined,
  });
  if (!claimed.ok) {
    console.info(
      JSON.stringify({
        event: "ASSET_EXTRACTION_RUNNER_SKIPPED",
        projectId,
        taskId,
        reason: claimed.reason,
      }),
    );
    return;
  }
  const runnerId = claimed.runnerId;

  const heartbeat = async () => {
    const ok = await renewAssetExtractionRunnerLease({ projectId, taskId, runnerId });
    if (!ok) {
      throw new Error("ASSET_EXTRACTION_RUNNER_LOST");
    }
  };

  try {
    await runAssetExtractionTaskBody({
      taskId,
      projectId,
      startTask: currentTask(await loadAssetExtractionStore(projectId), taskId) ?? claimed.task,
      heartbeat,
    });
  } finally {
    await releaseAssetExtractionRunnerLease({ projectId, taskId, runnerId });
  }
}

async function runAssetExtractionTaskBody(input: {
  taskId: string;
  projectId: string;
  startTask: AssetExtractionTask;
  heartbeat: () => Promise<void>;
}): Promise<void> {
  const { taskId, projectId, heartbeat } = input;
  const startTask = input.startTask;
  if (!isLiveExtractionStatus(startTask.status)) return;

  try {
    const draft = await loadScriptDraft(projectId);
    const sourceText = draft?.sourceText?.replace(/\r\n/g, "\n").trim() ?? "";
    if (startTask.scope === "all" && !sourceText) {
      throw new Error("请先上传并保存剧本后再提取资产");
    }
    const episode =
      startTask.scope === "episode"
        ? draft?.episodes.find((item) => item.id === startTask.episodeId)
        : null;
    if (startTask.scope === "episode" && !episode?.content.trim()) {
      throw new Error("剧集正文为空，无法提取资产");
    }

    const rosterProviderBundle = await resolveExtractionTextProvider({
      phase: "roster",
      modelKey: startTask.modelKey,
    });
    const detailProviderBundle = await resolveExtractionTextProvider({
      phase: "detail",
      modelKey: startTask.modelKey,
    });
    const episodesForScope =
      startTask.scope === "episode" && episode
        ? [episode]
        : (draft?.episodes ?? []);

    const chunks = buildScriptAssetChunks({
      sourceText:
        startTask.scope === "episode" ? episode?.content ?? "" : sourceText,
      episodes: episodesForScope,
    });
    if (chunks.length === 0) {
      throw new Error("剧本正文为空，无法发现资产名单");
    }

    let snapshot = await patchTask(projectId, taskId, {
      status:
        (startTask.roster?.length ?? 0) > 0
          ? startTask.status
          : "discovering_roster",
      stage:
        (startTask.roster?.length ?? 0) > 0
          ? startTask.stage
          : "discovering_roster",
      rosterChunksTotal: chunks.length,
      progress: buildAssetExtractionProgress(
        {
          ...startTask,
          stage:
            (startTask.roster?.length ?? 0) > 0
              ? startTask.stage
              : "discovering_roster",
          rosterChunksTotal: chunks.length,
        },
        { rosterChunksTotal: chunks.length },
      ),
    });
    let task = currentTask(snapshot, taskId)!;
    let liveProgress: AssetExtractionProgress =
      task.progress ??
      buildAssetExtractionProgress(task, { rosterChunksTotal: chunks.length });

    const alreadyInDetails =
      task.status === "extracting_details" ||
      task.status === "retrying_failed_once" ||
      task.status === "merging_roster" ||
      task.status === "saving" ||
      (task.detailItems ?? []).some(
        (item) =>
          item.status === "completed" ||
          item.status === "failed" ||
          item.status === "terminal_failed" ||
          item.status === "running",
      );

    if (!alreadyInDetails) {
      const rosterSystem = await buildExtractionPhaseSystemPrompt("roster");
      const pendingChunks = chunks.filter(
        (chunk) => !(task.rosterCompletedChunkIds ?? []).includes(chunk.chunkId),
      );
      const rosterChunkErrors: string[] = [];
      await mapPool(
        pendingChunks,
        ASSET_EXTRACTION_POLICY.rosterConcurrency,
        async (chunk) => {
        const collected = await collectProviderText({
          provider: rosterProviderBundle.provider,
          systemPrompt: rosterSystem,
          userPrompt: buildRosterUserPrompt({
            label: chunk.label,
            body: scriptAssetChunkBody(chunk),
          }),
          providerModelId: rosterProviderBundle.providerModelId,
          maxOutputTokens: 2_000,
        });
        const chunkIndex = Math.max(
          0,
          chunks.findIndex((item) => item.chunkId === chunk.chunkId),
        );
        const parsed = collected.ok
          ? parseRosterOutput(
              collected.text,
              chunk.episodeIds ?? [],
              chunkIndex * 10_000,
            )
          : { ok: false as const, error: collected.message };
        if (!parsed.ok) {
          rosterChunkErrors.push(`${chunk.label}：${parsed.error}`);
        }
        snapshot = await mutateAssetExtractionStore(projectId, (store) => {
          const current = currentTask(store, taskId);
          if (!current) return store;
          const completedIds = [
            ...new Set([
              ...(current.rosterCompletedChunkIds ?? []),
              chunk.chunkId,
            ]),
          ];
          const nextRoster = parsed.ok
            ? mergeRosterItems([...(current.roster ?? []), ...parsed.items])
            : (current.roster ?? []);
          const estimatedProgress = computeExtractionProgress({
            stage: "discovering_roster",
            rosterChunksCompleted: completedIds.length,
            rosterChunksTotal: Math.max(1, chunks.length),
            detailsCompleted: 0,
            detailsTotal: 0,
          });
          const progress: AssetExtractionProgress = {
            phase: "discovering_roster",
            estimatedProgress,
            roster: {
              scannedChunks: completedIds.length,
              totalChunks: chunks.length,
              discoveredCount: nextRoster.length,
            },
            details: {
              totalAssets: 0,
              completedAssets: 0,
              runningBatches: 0,
              completedBatches: 0,
              totalBatches: 0,
              retryRound: 0,
            },
          };
          liveProgress = progress;
          return {
            ...store,
            tasks: store.tasks.map((item) =>
              item.id === taskId
                ? {
                    ...item,
                    status: "discovering_roster" as const,
                    stage: "discovering_roster" as const,
                    roster: nextRoster,
                    rosterCompletedChunkIds: completedIds,
                    rosterChunksTotal: chunks.length,
                    estimatedProgress,
                    progress,
                    revision: item.revision + 1,
                    updatedAt: new Date().toISOString(),
                  }
                : item,
            ),
          };
        });
      });

      task = currentTask(snapshot, taskId)!;
      const roster = mergeRosterItems(task.roster ?? []);
      if (roster.length === 0) {
        throw new Error(
          rosterChunkErrors[0] ?? "资产名单发现失败",
        );
      }

      liveProgress = {
        phase: "merging_roster",
        estimatedProgress: 15,
        roster: {
          scannedChunks: chunks.length,
          totalChunks: chunks.length,
          discoveredCount: roster.length,
        },
        details: {
          totalAssets: roster.length,
          completedAssets: 0,
          runningBatches: 0,
          completedBatches: 0,
          totalBatches: Math.ceil(roster.length / ASSET_DETAIL_BATCH_SIZE),
          retryRound: 0,
        },
      };
      snapshot = await patchTask(projectId, taskId, {
        status: "merging_roster",
        stage: "merging_roster",
        roster,
        rosterChunksTotal: chunks.length,
        estimatedProgress: 15,
        progress: liveProgress,
      });

      if (startTask.scope === "episode") {
        const awaitingProgress: AssetExtractionProgress = {
          ...liveProgress,
          phase: "awaiting_roster_selection",
          estimatedProgress: 15,
        };
        await patchTask(projectId, taskId, {
          status: "awaiting_roster_selection",
          stage: "merging_roster",
          roster,
          rosterChunksTotal: chunks.length,
          estimatedProgress: 15,
          progress: awaitingProgress,
        });
        return;
      }

      const detailItems = detailItemsFromRoster(roster, task.detailItems);
      liveProgress = {
        ...liveProgress,
        phase: "extracting_details",
        estimatedProgress: computeExtractionProgress({
          stage: "extracting_details",
          rosterChunksCompleted: chunks.length,
          rosterChunksTotal: chunks.length,
          detailsCompleted: 0,
          detailsTotal: roster.length,
        }),
        details: {
          ...liveProgress.details,
          totalAssets: roster.length,
          completedAssets: 0,
          totalBatches: Math.ceil(roster.length / ASSET_DETAIL_BATCH_SIZE),
        },
      };
      snapshot = await patchTask(projectId, taskId, {
        status: "extracting_details",
        stage: "extracting_details",
        roster,
        detailItems,
        failedAssetQueue: [],
        rosterChunksTotal: chunks.length,
        estimatedProgress: liveProgress.estimatedProgress,
        progress: liveProgress,
      });
      task = currentTask(snapshot, taskId)!;
    }

    const roster = task.roster ?? [];
    if (roster.length === 0) {
      throw new Error("资产名单发现失败");
    }

    let detailItems = detailItemsFromRoster(roster, task.detailItems);
    const versionId = task.versionId;
    if (!versionId) {
      throw new Error("提取任务缺少版本");
    }

    let completedBatchIndexes = new Set<number>(
      (detailItems ?? [])
        .map((item) => item.batchIndex)
        .filter((value): value is number => typeof value === "number" && value > 0),
    );

    const persistOutcomes = async (
      outcomes: DetailBatchOutcome[],
      stage: AssetExtractionStage,
    ) => {
      const asTerminal = stage === "retrying_failed_once";
      const succeeded = outcomes
        .map((outcome) => outcome.asset)
        .filter((asset): asset is ExtractedAsset => Boolean(asset));
      for (const outcome of outcomes) {
        if (outcome.batchIndex > 0) completedBatchIndexes.add(outcome.batchIndex);
      }
      snapshot = await mutateAssetExtractionStore(projectId, (store) => {
        const current = currentTask(store, taskId);
        if (!current) return store;
        const nextItems = mergeDetailItems(
          current.detailItems ?? detailItems,
          outcomes,
          asTerminal,
        );
        detailItems = nextItems;
        const completedCount = nextItems.filter(
          (item) => item.status === "completed",
        ).length;
        const totalBatches = Math.max(
          1,
          Math.ceil(nextItems.length / ASSET_DETAIL_BATCH_SIZE),
        );
        const estimatedProgress = computeExtractionProgress({
          stage,
          rosterChunksCompleted: chunks.length,
          rosterChunksTotal: chunks.length,
          detailsCompleted: completedCount,
          detailsTotal: nextItems.length,
        });
        const progress: AssetExtractionProgress = {
          phase:
            stage === "retrying_failed_once"
              ? "retrying_failed_once"
              : "extracting_details",
          estimatedProgress,
          roster: {
            scannedChunks: chunks.length,
            totalChunks: chunks.length,
            discoveredCount: (current.roster ?? roster).length,
          },
          details: {
            totalAssets: nextItems.length,
            completedAssets: completedCount,
            runningBatches: 0,
            completedBatches: completedBatchIndexes.size,
            totalBatches,
            retryRound: stage === "retrying_failed_once" ? 1 : 0,
          },
        };
        liveProgress = progress;
        const withAssets = upsertVersionAssets({
          store,
          versionId,
          scope: current.scope,
          episodeId: current.episodeId,
          assets: succeeded,
        });
        return {
          ...withAssets,
          tasks: withAssets.tasks.map((item) =>
            item.id === taskId
              ? {
                  ...item,
                  status:
                    stage === "retrying_failed_once"
                      ? "retrying_failed_once"
                      : "extracting_details",
                  stage,
                  detailItems: nextItems,
                  failedAssetQueue: nextItems
                    .filter((entry) => entry.status === "failed")
                    .map((entry) => entry.assetKey),
                  estimatedProgress,
                  progress,
                  rosterChunksTotal: chunks.length,
                  revision: item.revision + 1,
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
        };
      });
    };

    const runPass = async (
      targets: AssetRosterItem[],
      stage: AssetExtractionStage,
    ) => {
      if (targets.length === 0) return;
      const totalBatches = Math.max(
        1,
        Math.ceil(targets.length / ASSET_DETAIL_BATCH_SIZE),
      );
      liveProgress = {
        phase:
          stage === "retrying_failed_once"
            ? "retrying_failed_once"
            : "extracting_details",
        estimatedProgress: computeExtractionProgress({
          stage,
          rosterChunksCompleted: chunks.length,
          rosterChunksTotal: chunks.length,
          detailsCompleted: detailItems.filter((item) => item.status === "completed")
            .length,
          detailsTotal: detailItems.length || targets.length,
        }),
        roster: {
          scannedChunks: chunks.length,
          totalChunks: chunks.length,
          discoveredCount: roster.length,
        },
        details: {
          totalAssets: detailItems.length || targets.length,
          completedAssets: detailItems.filter((item) => item.status === "completed")
            .length,
          runningBatches: 0,
          completedBatches: completedBatchIndexes.size,
          totalBatches:
            stage === "retrying_failed_once"
              ? totalBatches
              : Math.ceil(
                  (detailItems.length || targets.length) / ASSET_DETAIL_BATCH_SIZE,
                ),
          retryRound: stage === "retrying_failed_once" ? 1 : 0,
        },
      };
      snapshot = await patchTask(projectId, taskId, {
        status:
          stage === "retrying_failed_once"
            ? "retrying_failed_once"
            : "extracting_details",
        stage,
        estimatedProgress: liveProgress.estimatedProgress,
        progress: liveProgress,
        rosterChunksTotal: chunks.length,
      });
      task = currentTask(snapshot, taskId)!;
      detailItems = task.detailItems ?? detailItems;
      const detailSystem = await buildExtractionPhaseSystemPrompt("detail");
      await runAssetDetailBatches({
        items: targets,
        provider: detailProviderBundle.provider,
        systemPrompt: detailSystem,
        providerModelId: detailProviderBundle.providerModelId,
        episodes: episodesForScope,
        batchSize: ASSET_DETAIL_BATCH_SIZE,
        concurrency: ASSET_DETAIL_CONCURRENCY,
        onHeartbeat: heartbeat,
        onBatchStart: async (info) => {
          await heartbeat();
          snapshot = await mutateAssetExtractionStore(projectId, (store) => {
            const current = currentTask(store, taskId);
            if (!current) return store;
            const completedCount = (current.detailItems ?? detailItems).filter(
              (item) => item.status === "completed",
            ).length;
            const progress: AssetExtractionProgress = {
              phase:
                stage === "retrying_failed_once"
                  ? "retrying_failed_once"
                  : "extracting_details",
              estimatedProgress: computeExtractionProgress({
                stage,
                rosterChunksCompleted: chunks.length,
                rosterChunksTotal: chunks.length,
                detailsCompleted: completedCount,
                detailsTotal: (current.detailItems ?? detailItems).length,
              }),
              roster: {
                scannedChunks: chunks.length,
                totalChunks: chunks.length,
                discoveredCount: (current.roster ?? roster).length,
              },
              details: {
                totalAssets: (current.detailItems ?? detailItems).length,
                completedAssets: completedCount,
                runningBatches: info.runningBatchIndexes.length,
                completedBatches: completedBatchIndexes.size,
                totalBatches: info.totalBatches,
                retryRound: stage === "retrying_failed_once" ? 1 : 0,
              },
            };
            liveProgress = progress;
            return {
              ...store,
              tasks: store.tasks.map((item) =>
                item.id === taskId
                  ? {
                      ...item,
                      progress,
                      estimatedProgress: progress.estimatedProgress,
                      revision: item.revision + 1,
                      updatedAt: new Date().toISOString(),
                    }
                  : item,
              ),
            };
          });
        },
        onBatchSettled: async (outcomes) => {
          await heartbeat();
          await persistOutcomes(outcomes, stage);
        },
      });
      task = currentTask(snapshot, taskId)!;
      detailItems = task.detailItems ?? detailItems;
    };

    const pendingKeys = new Set(
      detailItems
        .filter((item) => item.status === "pending" || item.status === "running")
        .map((item) => item.assetKey),
    );
    const firstPass = roster.filter((item) => pendingKeys.has(item.assetKey));
    if (firstPass.length > 0) {
      await runPass(
        firstPass,
        task.status === "retrying_failed_once"
          ? "retrying_failed_once"
          : "extracting_details",
      );
    }

    const retryable = (currentTask(snapshot, taskId)?.detailItems ?? detailItems).filter(
      (item) => item.status === "failed",
    );
    if (retryable.length > 0) {
      completedBatchIndexes = new Set();
      liveProgress = {
        phase: "retrying_failed_once",
        estimatedProgress: 90,
        roster: {
          scannedChunks: chunks.length,
          totalChunks: chunks.length,
          discoveredCount: roster.length,
        },
        details: {
          totalAssets: detailItems.length,
          completedAssets: detailItems.filter((item) => item.status === "completed")
            .length,
          runningBatches: 0,
          completedBatches: 0,
          totalBatches: Math.ceil(retryable.length / ASSET_DETAIL_BATCH_SIZE),
          retryRound: 1,
        },
      };
      snapshot = await patchTask(projectId, taskId, {
        status: "retrying_failed_once",
        stage: "retrying_failed_once",
        failedAssetQueue: retryable.map((item) => item.assetKey),
        estimatedProgress: 90,
        progress: liveProgress,
        detailItems: (currentTask(snapshot, taskId)?.detailItems ?? detailItems).map(
          (item) =>
            item.status === "failed"
              ? { ...item, status: "pending" as const }
              : item,
        ),
      });
      task = currentTask(snapshot, taskId)!;
      detailItems = task.detailItems ?? detailItems;
      const retryRoster = roster.filter((item) =>
        retryable.some((entry) => entry.assetKey === item.assetKey),
      );
      await runPass(retryRoster, "retrying_failed_once");
    }

    task = currentTask(snapshot, taskId)!;
    detailItems = (task.detailItems ?? []).map((item) =>
      item.status === "failed"
        ? { ...item, status: "terminal_failed" as const }
        : item,
    );
    logTerminalFailed({
      projectId,
      taskId,
      items: detailItems,
    });

    const completedCountForSave = detailItems.filter(
      (item) => item.status === "completed",
    ).length;
    liveProgress = {
      phase: "saving",
      estimatedProgress: 98,
      roster: {
        scannedChunks: chunks.length,
        totalChunks: chunks.length,
        discoveredCount: roster.length,
      },
      details: {
        totalAssets: detailItems.length,
        completedAssets: completedCountForSave,
        runningBatches: 0,
        completedBatches: completedBatchIndexes.size,
        totalBatches: Math.ceil(
          Math.max(1, detailItems.length) / ASSET_DETAIL_BATCH_SIZE,
        ),
        retryRound: 0,
      },
    };
    snapshot = await patchTask(projectId, taskId, {
      status: "saving",
      stage: "saving",
      detailItems,
      estimatedProgress: 98,
      progress: liveProgress,
    });

    snapshot = await mutateAssetExtractionStore(projectId, (store) => {
      const current = currentTask(store, taskId);
      if (!current) return store;
      const priorResult = store.results.find(
        (result) =>
          result.versionId === versionId &&
          result.scope === current.scope &&
          result.episodeId === current.episodeId,
      );
      const selectedKeys = new Set(detailItems.map((item) => item.assetKey));
      const thisRunCompleted = (priorResult?.assets ?? []).filter((asset) =>
        detailItems.some(
          (item) =>
            item.status === "completed" && item.assetKey === asset.identity,
        ),
      );
      const preservedPrior = (priorResult?.assets ?? []).filter(
        (asset) => !selectedKeys.has(asset.identity),
      );
      const completedAssets = mergeSupplementAssets({
        activeAssets: preservedPrior,
        selectedExtractedAssets: thisRunCompleted,
      });
      const without = store.results.filter(
        (result) =>
          !(
            result.versionId === versionId &&
            result.scope === current.scope &&
            result.episodeId === current.episodeId
          ),
      );
      const doneProgress: AssetExtractionProgress = {
        phase: "completed",
        estimatedProgress: 100,
        roster: {
          scannedChunks: chunks.length,
          totalChunks: chunks.length,
          discoveredCount: (current.roster ?? roster).length,
        },
        details: {
          totalAssets: detailItems.length,
          completedAssets: completedAssets.length,
          runningBatches: 0,
          completedBatches: completedBatchIndexes.size,
          totalBatches: Math.ceil(
            Math.max(1, detailItems.length) / ASSET_DETAIL_BATCH_SIZE,
          ),
          retryRound: 0,
        },
      };
      return {
        ...store,
        results: [
          ...without,
          {
            versionId,
            scope: current.scope,
            episodeId: current.episodeId,
            assets: completedAssets,
          },
        ],
        tasks: store.tasks.map((item) =>
          item.id === taskId
            ? {
                ...item,
                status: "completed" as const,
                stage: "complete" as const,
                estimatedProgress: 100,
                progress: doneProgress,
                errorMessage: null,
                failedAssetQueue: detailItems
                  .filter((entry) => entry.status === "terminal_failed")
                  .map((entry) => entry.assetKey),
                detailItems,
                revision: item.revision + 1,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      };
    });

    const saved = snapshot;
    const candidate = getCandidateVersion(saved);
    const active = getActiveVersion(saved);
    if (candidate && candidate.id === versionId) {
      if (!active) {
        await applyCandidateVersion({ projectId });
      } else {
        const conflicts = detectExtractionConflicts({
          activeAssets: mergedAssetsForVersion(saved, active.id),
          candidateAssets: mergedAssetsForVersion(saved, candidate.id),
          overrides: saved.overrides.filter(
            (override) => override.versionId === active.id,
          ),
        });
        if (conflicts.length === 0) {
          await applyCandidateVersion({ projectId });
        }
      }
    } else {
      await materializeActiveVersionToBundle(projectId, saved);
    }
    if (startTask.scope === "episode" && startTask.episodeId) {
      const result = saved.results.find(
        (entry) =>
          entry.versionId === versionId &&
          entry.scope === "episode" &&
          entry.episodeId === startTask.episodeId,
      );
      const successfulAssets = result?.assets ?? [];
      if (successfulAssets.length > 0) {
        await persistEpisodeExtractToDesignRecord({
          projectId,
          episodeId: startTask.episodeId,
          parsed: extractedAssetsToDto(successfulAssets),
          generationId: startTask.id,
        });
      }
      const { runEpisodeExtractionDownstream } = await import(
        "@/projects/storyboard/services/episode-extraction-downstream"
      );
      void runEpisodeExtractionDownstream({
        projectId,
        episodeId: startTask.episodeId,
        actorUserId: startTask.actorUserId,
      }).catch((error) => {
        console.error("[storyboard] downstream-pipeline-error", {
          projectId,
          episodeId: startTask.episodeId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    } else if (startTask.scope === "all") {
      const { runProjectExtractionDownstream } = await import(
        "@/projects/storyboard/services/episode-extraction-downstream"
      );
      void runProjectExtractionDownstream({
        projectId,
        actorUserId: startTask.actorUserId,
      }).catch((error) => {
        console.error("[storyboard] project-downstream-error", {
          projectId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "资产提取失败";
    if (message === "ASSET_EXTRACTION_RUNNER_LOST") {
      return;
    }
    await mutateAssetExtractionStore(projectId, (store) => {
      const task = currentTask(store, taskId);
      if (!task || !isLiveExtractionStatus(task.status)) return store;
      return {
        ...store,
        tasks: store.tasks.map((item) =>
          item.id === taskId
            ? {
                ...item,
                status: "failed" as const,
                errorMessage: message,
                revision: item.revision + 1,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      };
    });
  }
}
