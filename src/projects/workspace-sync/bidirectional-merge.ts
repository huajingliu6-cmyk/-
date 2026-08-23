import { assetBundleDocumentRevision } from "@/projects/assets/asset-bundle-revision";
import { loadAssetBundleDraft, saveAssetBundleDraftCas } from "@/projects/assets/asset-bundle-store";
import { operationDigest } from "@/projects/stable-digest";
import {
  loadMergeBase,
  saveMergeBaseCas,
  type MergeBaseDocument,
} from "@/projects/workspace-sync/merge-base-store";
import {
  BIDIRECTIONAL_MERGE_TYPE,
  type SyncConflictRecord,
} from "@/projects/workspace-sync/sync-model";
import {
  emptyAssetBundle,
  threeWayMergeAssetBundles,
} from "@/projects/workspace-sync/three-way-merge";
import {
  loadWorkspaceLocalAssets,
  saveWorkspaceLocalAssetsCas,
} from "@/projects/workspace-sync/store";

async function planMerge(projectId: string): Promise<{
  digest: string;
  managementRevision: number;
  workspaceRevision: number;
  base: MergeBaseDocument;
  merged: ReturnType<typeof threeWayMergeAssetBundles>;
}> {
  const [management, workspace, prev] = await Promise.all([
    loadAssetBundleDraft(projectId).catch(() => null),
    loadWorkspaceLocalAssets(projectId).catch(() => null),
    loadMergeBase(projectId),
  ]);
  const mgmtBundle = management ?? emptyAssetBundle(projectId);
  const wsBundle = workspace ?? emptyAssetBundle(projectId);
  const ancestor = prev?.ancestor ?? emptyAssetBundle(projectId);
  const managementRevision = management
    ? (assetBundleDocumentRevision(management) ?? 0)
    : 0;
  const workspaceRevision = workspace
    ? (assetBundleDocumentRevision(workspace) ?? 0)
    : 0;
  const merged = threeWayMergeAssetBundles({
    base: ancestor,
    management: mgmtBundle,
    workspace: wsBundle,
  });
  const digest = operationDigest({
    kind: BIDIRECTIONAL_MERGE_TYPE,
    projectId,
    managementRevision,
    workspaceRevision,
    ancestorDigest: operationDigest(ancestor),
    conflictFields: merged.conflicts.map(
      (c) => `${c.entityType}:${c.entityId}:${c.field}`,
    ),
  });
  return {
    digest,
    managementRevision,
    workspaceRevision,
    base: prev ?? {
      projectId,
      managementRevision: 0,
      workspaceRevision: 0,
      syncDigest: "",
      ancestor,
      conflicts: [],
      updatedAt: new Date().toISOString(),
      documentRevision: 0,
    },
    merged,
  };
}

function conflictKey(conflict: {
  entityType: string;
  entityId: string;
  field: string;
}): string {
  return `${conflict.entityType}:${conflict.entityId}:${conflict.field}`;
}

function attachConflictMeta(
  conflicts: ReturnType<typeof threeWayMergeAssetBundles>["conflicts"],
  managementRevision: number,
  workspaceRevision: number,
  previous: SyncConflictRecord[] = [],
): SyncConflictRecord[] {
  const openKeys = new Set(conflicts.map(conflictKey));
  const next: SyncConflictRecord[] = conflicts.map((conflict) => ({
    ...conflict,
    operationId: "",
    managementRevision,
    workspaceRevision,
    status: "open",
  }));
  for (const prior of previous) {
    if (prior.status === "resolved" && !openKeys.has(conflictKey(prior))) {
      next.push(prior);
    }
  }
  return next;
}

export async function runBidirectionalMerge(projectId: string): Promise<void> {
  let planned = await planMerge(projectId);
  const conflicts = attachConflictMeta(
    planned.merged.conflicts,
    planned.managementRevision,
    planned.workspaceRevision,
    planned.base.conflicts,
  );
  const nextBase: MergeBaseDocument = {
    ...planned.base,
    managementRevision: planned.managementRevision,
    workspaceRevision: planned.workspaceRevision,
    syncDigest: planned.digest,
    ancestor: planned.merged.ancestor,
    conflicts,
    updatedAt: new Date().toISOString(),
  };

  if (conflicts.length === 0) {
    const currentMgmt = await loadAssetBundleDraft(projectId).catch(() => null);
    const currentWs = await loadWorkspaceLocalAssets(projectId).catch(() => null);
    const mgmtChanged =
      currentMgmt &&
      JSON.stringify({
        characters: currentMgmt.characters,
        scenes: currentMgmt.scenes,
        props: currentMgmt.props,
        audios: currentMgmt.audios,
      }) !==
        JSON.stringify({
          characters: planned.merged.management.characters,
          scenes: planned.merged.management.scenes,
          props: planned.merged.management.props,
          audios: planned.merged.management.audios,
        });
    const wsChanged =
      currentWs &&
      JSON.stringify({
        characters: currentWs.characters,
        scenes: currentWs.scenes,
        props: currentWs.props,
        audios: currentWs.audios,
      }) !==
        JSON.stringify({
          characters: planned.merged.workspace.characters,
          scenes: planned.merged.workspace.scenes,
          props: planned.merged.workspace.props,
          audios: planned.merged.workspace.audios,
        });
    if (currentMgmt && mgmtChanged) {
      await saveAssetBundleDraftCas({
        ...planned.merged.management,
        updatedAt: currentMgmt.updatedAt,
        documentRevision: assetBundleDocumentRevision(currentMgmt),
      } as typeof currentMgmt);
    }
    if (currentWs && wsChanged) {
      await saveWorkspaceLocalAssetsCas({
        ...planned.merged.workspace,
        updatedAt: currentWs.updatedAt,
        documentRevision: assetBundleDocumentRevision(currentWs),
      } as typeof currentWs);
    }
  }

  try {
    await saveMergeBaseCas(nextBase);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "REVISION_CONFLICT") {
      throw error;
    }
    planned = await planMerge(projectId);
    const retriedConflicts = attachConflictMeta(
      planned.merged.conflicts,
      planned.managementRevision,
      planned.workspaceRevision,
      planned.base.conflicts,
    );
    await saveMergeBaseCas({
      ...planned.base,
      managementRevision: planned.managementRevision,
      workspaceRevision: planned.workspaceRevision,
      syncDigest: planned.digest,
      ancestor: planned.merged.ancestor,
      conflicts: retriedConflicts,
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function readMergeConflicts(
  projectId: string,
): Promise<SyncConflictRecord[]> {
  const base = await loadMergeBase(projectId);
  return base?.conflicts ?? [];
}
