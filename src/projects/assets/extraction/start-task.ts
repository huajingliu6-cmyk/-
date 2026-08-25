import { randomUUID } from "crypto";
import { migrateAssetExtractionSlotBindings } from "@/ai-config/migrate-asset-extraction-slot-bindings";
import { migrateStyPlatformAssetExtractTaskRules } from "@/ai-config/migrate-sty-platform-asset-extract-task-rules";
import { ensureAssetExtractionMigrated } from "@/projects/assets/extraction/migrate";
import {
  defaultAssetExtractionModelKey,
  resolveAssetExtractionModelKey,
} from "@/projects/assets/extraction/models";
import {
  allAssetsTaskKey,
  episodeAssetsTaskKey,
} from "@/projects/assets/extraction/task-key";
import {
  getActiveVersion,
  getLiveTask,
  lastSuccessfulModelKey,
  mutateAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import type {
  AssetExtractionScope,
  AssetExtractionTask,
} from "@/projects/assets/extraction/types";
import { dispatchAssetExtractionRunner } from "@/projects/assets/extraction/run-task";

export type StartAssetExtractionInput = {
  projectId: string;
  sourceFingerprint: string;
  scope: AssetExtractionScope;
  episodeId?: string | null;
  modelKey?: string | null;
  actorUserId?: string | null;
};

export async function startAssetExtractionTask(
  input: StartAssetExtractionInput,
): Promise<{ task: AssetExtractionTask; reused: boolean }> {
  await Promise.all([
    migrateStyPlatformAssetExtractTaskRules(),
    migrateAssetExtractionSlotBindings(),
  ]);
  await ensureAssetExtractionMigrated(input.projectId);
  const requestedModel = input.modelKey
    ? resolveAssetExtractionModelKey(input.modelKey)
    : null;
  const episodeId =
    input.scope === "episode" ? input.episodeId?.trim() || "" : "";
  if (input.scope === "episode" && !episodeId) {
    throw new Error("MISSING_EPISODE_ID");
  }
  const taskKey =
    input.scope === "all"
      ? allAssetsTaskKey(input.projectId, input.sourceFingerprint)
      : episodeAssetsTaskKey(
          input.projectId,
          input.sourceFingerprint,
          episodeId,
        );

  let reused = false;
  let conflictTask: AssetExtractionTask | null = null;
  const result = await mutateAssetExtractionStore(input.projectId, (store) => {
    const existing = getLiveTask(store, taskKey);
    if (existing) {
      reused = true;
      return store;
    }
    const otherLive = getLiveTask(store);
    if (otherLive) {
      conflictTask = otherLive;
      return store;
    }

    const now = new Date().toISOString();
    const active = getActiveVersion(store);
    const isFullExtract = input.scope === "all";
    const versionId = isFullExtract ? randomUUID() : active?.id ?? randomUUID();
    const attempt =
      store.versions.filter(
        (version) => version.sourceFingerprint === input.sourceFingerprint,
      ).length + 1;
    const task: AssetExtractionTask = {
      id: randomUUID(),
      projectId: input.projectId,
      taskKey,
      sourceFingerprint: input.sourceFingerprint,
      scope: input.scope,
      episodeId: input.scope === "episode" ? episodeId : null,
      modelKey:
        requestedModel ||
        lastSuccessfulModelKey(store) ||
        defaultAssetExtractionModelKey(),
      status: "discovering_roster",
      stage: "discovering_roster",
      estimatedProgress: 0,
      revision: 1,
      errorMessage: null,
      versionId,
      createdAt: now,
      updatedAt: now,
      actorUserId: input.actorUserId?.trim() || null,
      roster: [],
      detailItems: [],
      failedAssetQueue: [],
      rosterCompletedChunkIds: [],
      progress: {
        phase: "discovering_roster",
        estimatedProgress: 0,
        roster: {
          scannedChunks: 0,
          totalChunks: 1,
          discoveredCount: 0,
        },
        details: {
          totalAssets: 0,
          completedAssets: 0,
          runningBatches: 0,
          completedBatches: 0,
          totalBatches: 0,
          retryRound: 0,
        },
      },
    };
    const versions = isFullExtract
      ? [
          ...store.versions.map((version) =>
            version.status === "candidate"
              ? { ...version, status: "archived" as const }
              : version,
          ),
          {
            id: versionId,
            projectId: input.projectId,
            sourceFingerprint: input.sourceFingerprint,
            status: "candidate" as const,
            modelKey: task.modelKey,
            attempt,
            createdAt: now,
          },
        ]
      : store.versions.some((version) => version.id === versionId)
        ? store.versions
        : [
            ...store.versions,
            {
              id: versionId,
              projectId: input.projectId,
              sourceFingerprint: input.sourceFingerprint,
              status: "active" as const,
              modelKey: task.modelKey,
              attempt: 1,
              createdAt: now,
            },
          ];
    return {
      ...store,
      tasks: [...store.tasks, task],
      versions,
    };
  });

  if (conflictTask) {
    throw new Error("ASSET_EXTRACTION_IN_PROGRESS");
  }
  const live = getLiveTask(result, taskKey);
  if (!live) {
    throw new Error("FAILED_TO_CREATE_EXTRACTION_TASK");
  }
  void dispatchAssetExtractionRunner(live.id, input.projectId);
  return { task: live, reused };
}
