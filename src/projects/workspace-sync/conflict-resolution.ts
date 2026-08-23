import { assetBundleDocumentRevision } from "@/projects/assets/asset-bundle-revision";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraftCas,
  type AssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import type { ProjectAssetBundle, ProjectAssetType } from "@/projects/assets/types";
import { wrapWriteFailure } from "@/projects/operation-failed";
import { operationDigest } from "@/projects/stable-digest";
import { loadMergeBase, saveMergeBaseCas } from "@/projects/workspace-sync/merge-base-store";
import { validateConflictFieldValue } from "@/projects/workspace-sync/conflict-field-schema";
import {
  CONFLICT_RESOLUTION_TYPE,
  type SyncConflictRecord,
} from "@/projects/workspace-sync/sync-model";
import { emptyAssetBundle, threeWayMergeAssetBundles } from "@/projects/workspace-sync/three-way-merge";
import {
  loadWorkspaceLocalAssets,
  saveWorkspaceLocalAssetsCas,
} from "@/projects/workspace-sync/store";

export const SYNC_CONFLICT_STALE = "SYNC_CONFLICT_STALE";
export type OperationStoreKind = "management" | "workspace" | "shared";
export type ConflictResolutionChoice = "management" | "workspace" | "manual";

let testHooks: {
  failAfterManagementWrite?: boolean;
  failAfterWorkspaceWrite?: boolean;
} = {};

export function setConflictResolutionTestHooks(
  hooks: typeof testHooks,
): void {
  testHooks = { ...hooks };
}

export function resetConflictResolutionTestHooks(): void {
  testHooks = {};
}

export type SyncConflictDetail = SyncConflictRecord & {
  projectId: string;
  store: OperationStoreKind;
  mergeOperationId: string;
};

const LIST_KEY: Record<ProjectAssetType, keyof Pick<
  ProjectAssetBundle,
  "characters" | "scenes" | "props" | "audios"
>> = {
  character: "characters",
  scene: "scenes",
  prop: "props",
  audio: "audios",
};

function stableEqual(a: unknown, b: unknown): boolean {
  return operationDigest(a ?? null) === operationDigest(b ?? null);
}

function conflictKey(conflict: {
  entityType: string;
  entityId: string;
  field: string;
}): string {
  return `${conflict.entityType}:${conflict.entityId}:${conflict.field}`;
}

function entityFieldValue(
  bundle: ProjectAssetBundle | null | undefined,
  entityType: ProjectAssetType,
  entityId: string,
  field: string,
): unknown {
  if (!bundle) return undefined;
  const list = bundle[LIST_KEY[entityType]] as Array<Record<string, unknown>>;
  const entity = list.find((item) => item.id === entityId);
  return entity ? entity[field] : undefined;
}

function applyField(
  bundle: AssetBundleDraft,
  entityType: ProjectAssetType,
  entityId: string,
  field: string,
  value: unknown,
): AssetBundleDraft {
  const key = LIST_KEY[entityType];
  const list = bundle[key] as Array<Record<string, unknown>>;
  return {
    ...bundle,
    [key]: list.map((item) =>
      item.id === entityId ? { ...item, [field]: value, imageObjectUrl: null } : item,
    ),
  };
}

export function conflictResolutionDigest(input: {
  mergeOperationId: string;
  projectId: string;
  store: OperationStoreKind;
  entityType: string;
  entityId: string;
  field: string;
  choice: ConflictResolutionChoice;
  value: unknown;
  managementRevision: number;
  workspaceRevision: number;
}): string {
  return operationDigest({
    kind: CONFLICT_RESOLUTION_TYPE,
    mergeOperationId: input.mergeOperationId,
    projectId: input.projectId,
    store: input.store,
    entityType: input.entityType,
    entityId: input.entityId,
    field: input.field,
    choice: input.choice,
    value: input.value,
    managementRevision: input.managementRevision,
    workspaceRevision: input.workspaceRevision,
  });
}

export function deriveConflictResolutionOperationId(input: {
  mergeOperationId: string;
  projectId: string;
  store: OperationStoreKind;
  entityType: string;
  entityId: string;
  field: string;
  choice: ConflictResolutionChoice;
  value: unknown;
  managementRevision: number;
  workspaceRevision: number;
}): string {
  return `op_${conflictResolutionDigest(input)}`;
}

export async function listSyncConflicts(
  projectId: string,
  store: OperationStoreKind,
): Promise<{
  projectId: string;
  store: OperationStoreKind;
  mergeStatus: "ok" | "conflict";
  conflicts: SyncConflictDetail[];
}> {
  const base = await loadMergeBase(projectId);
  const conflicts = (base?.conflicts ?? []).map((conflict) => ({
    ...conflict,
    status: conflict.status ?? "open",
    projectId,
    store,
    mergeOperationId: conflict.operationId,
  }));
  return {
    projectId,
    store,
    mergeStatus: conflicts.some((item) => (item.status ?? "open") === "open")
      ? "conflict"
      : "ok",
    conflicts,
  };
}

function chosenValue(
  conflict: SyncConflictRecord,
  choice: ConflictResolutionChoice,
  manualValue: unknown,
): unknown {
  if (choice === "management") return conflict.managementValue;
  if (choice === "workspace") return conflict.workspaceValue;
  return manualValue;
}

function throwStale(message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.name = SYNC_CONFLICT_STALE;
  error.code = SYNC_CONFLICT_STALE;
  throw error;
}

export async function resolveSyncConflict(input: {
  projectId: string;
  store: OperationStoreKind;
  entityType: ProjectAssetType;
  entityId: string;
  field: string;
  choice: ConflictResolutionChoice;
  value?: unknown;
  operationId?: string | null;
}): Promise<{
  conflict: SyncConflictDetail;
  mergeStatus: "ok" | "conflict";
  operationId: string;
}> {
  const listed = await listSyncConflicts(input.projectId, input.store);
  const snapshot = listed.conflicts.find(
    (item) =>
      item.entityType === input.entityType &&
      item.entityId === input.entityId &&
      item.field === input.field,
  );
  if (!snapshot) {
    throwStale("冲突快照不存在或已失效");
  }

  const value = chosenValue(snapshot, input.choice, input.value);
  if (input.choice === "manual") {
    const valid = validateConflictFieldValue(input.entityType, input.field, value);
    if (!valid.ok) {
      const error = new Error(valid.error);
      error.name = "INVALID_CONFLICT_VALUE";
      throw error;
    }
  }

  const digestInput = {
    mergeOperationId: snapshot.operationId,
    projectId: input.projectId,
    store: input.store,
    entityType: input.entityType,
    entityId: input.entityId,
    field: input.field,
    choice: input.choice,
    value,
    managementRevision: snapshot.managementRevision,
    workspaceRevision: snapshot.workspaceRevision,
  };
  const derivedId = deriveConflictResolutionOperationId(digestInput);
  const operationId = input.operationId?.trim() || derivedId;

  try {
    const [management, workspace, base] = await Promise.all([
      loadAssetBundleDraft(input.projectId).catch(() => null),
      loadWorkspaceLocalAssets(input.projectId).catch(() => null),
      loadMergeBase(input.projectId),
    ]);
    const live = (base?.conflicts ?? []).find(
      (item) =>
        item.entityType === input.entityType &&
        item.entityId === input.entityId &&
        item.field === input.field,
    );
    if (!live) {
      throwStale("冲突快照已不存在，拒绝按旧快照覆盖");
    }
    if (
      live.status === "resolved" &&
      live.resolutionOperationId === operationId
    ) {
      return {
        conflict: toDetail(live, input.projectId, input.store),
        mergeStatus: remainingOpen(base!.conflicts) ? "conflict" : "ok",
        operationId,
      };
    }
    if (live.status === "resolved") {
      if (stableEqual(live.resolvedValue, value)) {
        return {
          conflict: toDetail(live, input.projectId, input.store),
          mergeStatus: remainingOpen(base!.conflicts) ? "conflict" : "ok",
          operationId: live.resolutionOperationId || operationId,
        };
      }
      throwStale("冲突已被其他 resolution 解决");
    }

    const mgmtRev = management ? (assetBundleDocumentRevision(management) ?? 0) : 0;
    const wsRev = workspace ? (assetBundleDocumentRevision(workspace) ?? 0) : 0;
    if (
      mgmtRev !== live.managementRevision ||
      wsRev !== live.workspaceRevision ||
      mgmtRev !== snapshot.managementRevision ||
      wsRev !== snapshot.workspaceRevision
    ) {
      throwStale("双方 revision 已变化，拒绝按旧冲突快照覆盖");
    }
    const liveMgmt = entityFieldValue(
      management,
      input.entityType,
      input.entityId,
      input.field,
    );
    const liveWs = entityFieldValue(
      workspace,
      input.entityType,
      input.entityId,
      input.field,
    );
    if (
      !stableEqual(liveMgmt, live.managementValue) ||
      !stableEqual(liveWs, live.workspaceValue) ||
      !stableEqual(liveMgmt, snapshot.managementValue) ||
      !stableEqual(liveWs, snapshot.workspaceValue)
    ) {
      throwStale("字段值已变化，拒绝按旧冲突快照覆盖");
    }

    if (management) {
      const next = applyField(
        management,
        input.entityType,
        input.entityId,
        input.field,
        value,
      );
      await saveAssetBundleDraftCas(next, { skipNameChangeHints: true });
    }
    if (testHooks.failAfterManagementWrite) {
      testHooks.failAfterManagementWrite = false;
      throw new Error("TEST_AFTER_MANAGEMENT_WRITE");
    }
    if (workspace) {
      const next = applyField(
        workspace,
        input.entityType,
        input.entityId,
        input.field,
        value,
      );
      await saveWorkspaceLocalAssetsCas(next, { skipNameChangeHints: true });
    }
    if (testHooks.failAfterWorkspaceWrite) {
      testHooks.failAfterWorkspaceWrite = false;
      throw new Error("TEST_AFTER_WORKSPACE_WRITE");
    }

    const [nextMgmt, nextWs] = await Promise.all([
      loadAssetBundleDraft(input.projectId).catch(() => null),
      loadWorkspaceLocalAssets(input.projectId).catch(() => null),
    ]);
    const ancestor = applyField(
      (base?.ancestor
        ? { ...base.ancestor, updatedAt: base.updatedAt }
        : {
            ...emptyAssetBundle(input.projectId),
            updatedAt: new Date().toISOString(),
          }) as AssetBundleDraft,
      input.entityType,
      input.entityId,
      input.field,
      value,
    );
    const merged = threeWayMergeAssetBundles({
      base: ancestor,
      management: nextMgmt ?? emptyAssetBundle(input.projectId),
      workspace: nextWs ?? emptyAssetBundle(input.projectId),
    });
    const resolved: SyncConflictRecord = {
      ...live,
      status: "resolved",
      resolvedBy: input.choice,
      resolvedValue: value,
      resolutionOperationId: operationId,
      resolvedAt: new Date().toISOString(),
    };
    const afterMgmtRev = nextMgmt
      ? (assetBundleDocumentRevision(nextMgmt) ?? mgmtRev)
      : mgmtRev;
    const afterWsRev = nextWs
      ? (assetBundleDocumentRevision(nextWs) ?? wsRev)
      : wsRev;
    const openKeys = new Set(merged.conflicts.map(conflictKey));
    const nextConflicts: SyncConflictRecord[] = merged.conflicts.map((conflict) => ({
      ...conflict,
      operationId: live.operationId,
      managementRevision: afterMgmtRev,
      workspaceRevision: afterWsRev,
      status: "open",
    }));
    for (const prior of base?.conflicts ?? []) {
      if (conflictKey(prior) === conflictKey(resolved)) {
        nextConflicts.push(resolved);
        continue;
      }
      if (prior.status === "resolved" && !openKeys.has(conflictKey(prior))) {
        nextConflicts.push(prior);
      }
    }
    await saveMergeBaseCas({
      projectId: input.projectId,
      managementRevision: afterMgmtRev,
      workspaceRevision: afterWsRev,
      syncDigest: operationDigest({
        kind: "merge-after-resolution",
        projectId: input.projectId,
        conflicts: nextConflicts.map(conflictKey),
      }),
      ancestor,
      conflicts: nextConflicts,
      updatedAt: new Date().toISOString(),
      documentRevision: base?.documentRevision ?? 0,
    });
    return {
      conflict: toDetail(resolved, input.projectId, input.store),
      mergeStatus: remainingOpen(nextConflicts) ? "conflict" : "ok",
      operationId,
    };
  } catch (error) {
    if (error instanceof Error && error.name === SYNC_CONFLICT_STALE) throw error;
    if (error instanceof Error && error.name === "INVALID_CONFLICT_VALUE") throw error;
    wrapWriteFailure(error);
  }
}

function remainingOpen(conflicts: SyncConflictRecord[]): boolean {
  return conflicts.some((item) => (item.status ?? "open") === "open");
}

function toDetail(
  conflict: SyncConflictRecord,
  projectId: string,
  store: OperationStoreKind,
): SyncConflictDetail {
  return {
    ...conflict,
    status: conflict.status ?? "open",
    projectId,
    store,
    mergeOperationId: conflict.operationId,
  };
}
