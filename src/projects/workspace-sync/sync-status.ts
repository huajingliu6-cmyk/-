import {
  loadMergeBase,
} from "@/projects/workspace-sync/merge-base-store";
import { loadMediaSyncLedger } from "@/projects/workspace-sync/media-sync-ledger";
import { loadWorkspaceSnapshot } from "@/projects/workspace-sync/store";
import {
  BIDIRECTIONAL_MERGE_TYPE,
  MEDIA_METADATA_SYNC_TYPE,
  WORKSPACE_DOWNSTREAM_SYNC_TYPE,
  type ProjectSyncItem,
  type ProjectSyncStatus,
  type SyncLifecycle,
} from "@/projects/workspace-sync/sync-model";

function retryPathFor(
  projectId: string,
  store: "management" | "workspace" | "shared",
): string {
  const encoded = encodeURIComponent(projectId);
  if (store === "management") {
    return `/api/projects/${encoded}/sync-status`;
  }
  return `/api/workspace/projects/${encoded}/sync-status`;
}

export async function readProjectSyncStatus(
  projectId: string,
): Promise<ProjectSyncStatus> {
  const [snapshot, mergeBase, mediaLedger] = await Promise.all([
    loadWorkspaceSnapshot(projectId).catch(() => null),
    loadMergeBase(projectId),
    loadMediaSyncLedger(projectId),
  ]);
  const items: ProjectSyncItem[] = [];

  if (snapshot && snapshot.syncStatus && snapshot.syncStatus !== "ok") {
    items.push({
      kind: WORKSPACE_DOWNSTREAM_SYNC_TYPE,
      syncStatus: snapshot.syncStatus,
      sourceStore: "management",
      targetStore: "workspace",
      scope: "workspace-snapshot",
      reason: snapshot.syncError,
      operationId: snapshot.syncOperationId ?? null,
      parentOperationId: snapshot.parentOperationId ?? null,
      statusUrl: null,
      retryPath: retryPathFor(projectId, "workspace"),
    });
  }

  const openConflicts = (mergeBase?.conflicts ?? []).filter(
    (conflict) => (conflict.status ?? "open") === "open",
  );
  if (openConflicts.length > 0) {
    items.push(
      ...openConflicts.map((conflict) => ({
        kind: BIDIRECTIONAL_MERGE_TYPE,
        syncStatus: "conflict" as const,
        sourceStore: "shared" as const,
        targetStore: "shared" as const,
        scope: `asset-bundle-merge:${conflict.entityType}:${conflict.entityId}:${conflict.field}`,
        reason: `${conflict.entityType} ${conflict.field} 字段冲突待处理`,
        operationId: conflict.operationId,
        parentOperationId: null,
        statusUrl: null,
        retryPath: retryPathFor(projectId, "workspace"),
        entityId: conflict.entityId,
        entityType: conflict.entityType,
        conflicts: [conflict],
      })),
    );
  }

  for (const entry of Object.values(mediaLedger.entries)) {
    if (entry.status === "ok") continue;
    items.push({
      kind: MEDIA_METADATA_SYNC_TYPE,
      syncStatus:
        entry.status === "failed"
          ? "failed"
          : entry.status === "unknown"
            ? "failed"
            : "pending",
      sourceStore: entry.store,
      targetStore: entry.store,
      scope: `media:${entry.storageKey}`,
      reason: entry.error ?? "待补齐资产 metadata",
      operationId: entry.operationId,
      parentOperationId: null,
      statusUrl: null,
      retryPath: retryPathFor(projectId, entry.store),
      entityId: entry.assetId,
      entityType: "media",
    });
  }

  const worst = worstStatus(items, snapshot?.syncStatus ?? "ok");
  const first = items[0] ?? null;
  return {
    syncStatus: worst,
    syncError: first?.reason ?? snapshot?.syncError ?? null,
    operationId: first?.operationId ?? snapshot?.syncOperationId ?? null,
    parentOperationId:
      first?.parentOperationId ?? snapshot?.parentOperationId ?? null,
    sourceManagementRevision: snapshot?.sourceManagementRevision ?? null,
    retryPath: retryPathFor(projectId, "workspace"),
    items,
  };
}

function worstStatus(
  items: ProjectSyncItem[],
  fallback: SyncLifecycle,
): SyncLifecycle {
  const rank: SyncLifecycle[] = [
    "conflict",
    "failed",
    "pending",
    "committed",
    "ok",
  ];
  for (const status of rank) {
    if (items.some((item) => item.syncStatus === status)) return status;
  }
  return fallback === "unknown" ? "failed" : fallback;
}

export async function retryProjectSync(projectId: string): Promise<ProjectSyncStatus> {
  const { syncManagementToWorkspace } = await import(
    "@/projects/workspace-sync/sync-management-to-workspace"
  );
  await syncManagementToWorkspace(projectId).catch(() => undefined);
  const { runBidirectionalMerge } = await import(
    "@/projects/workspace-sync/bidirectional-merge"
  );
  await runBidirectionalMerge(projectId).catch(() => undefined);
  const { loadMediaSyncLedger, commitMediaMetadataRestore } = await import(
    "@/projects/workspace-sync/media-sync-ledger"
  );
  const ledger = await loadMediaSyncLedger(projectId);
  for (const entry of Object.values(ledger.entries)) {
    if (entry.status === "ok") continue;
    await commitMediaMetadataRestore({
      projectId,
      storageKey: entry.storageKey,
      store: entry.store,
    }).catch(() => undefined);
  }
  return readProjectSyncStatus(projectId);
}
