import { createHash } from "crypto";
import {
  assetBundleDocumentRevision,
  readAssetDocumentRevisionField,
} from "@/projects/assets/asset-bundle-revision";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { getScriptEpisodeContentFingerprint } from "@/projects/assets/episode-design/fingerprint";
import {
  loadEpisodeAssetDesignStore,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import type { EpisodeAssetDesignRecord } from "@/projects/assets/episode-design/types";
import { isRevisionConflictError } from "@/projects/operation-failed";
import { operationDigest } from "@/projects/stable-digest";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import { stableHash } from "@/projects/storyboard/hash";
import {
  loadWorkspaceLocalEpisodeDesigns,
  loadWorkspaceSnapshot,
  saveWorkspaceLocalEpisodeDesigns,
  saveWorkspaceSnapshot,
} from "@/projects/workspace-sync/store";
import type {
  WorkspaceSnapshot,
  WorkspaceSnapshotEpisode,
} from "@/projects/workspace-sync/types";

export const WORKSPACE_DOWNSTREAM_SYNC_TYPE = "workspace-downstream-sync";

export function computeSourceFingerprint(input: {
  episodes: WorkspaceSnapshotEpisode[];
  assetsUpdatedAt: string | null;
  designsUpdatedAt: string | null;
}): string {
  const episodePayload = input.episodes
    .map((ep) =>
      [
        ep.id,
        String(ep.episodeNumber),
        getScriptEpisodeContentFingerprint({
          episodeNumber: ep.episodeNumber,
          title: ep.title,
          content: ep.content,
        }),
      ].join(":"),
    )
    .join("|");
  return stableHash(
    [episodePayload, input.assetsUpdatedAt ?? "", input.designsUpdatedAt ?? ""].join(
      "\n",
    ),
  );
}

function markLocalDesignsStale(input: {
  localRecords: EpisodeAssetDesignRecord[];
  snapshotEpisodes: WorkspaceSnapshotEpisode[];
}): EpisodeAssetDesignRecord[] {
  const fingerprintByEpisodeId = new Map<string, string>();
  for (const ep of input.snapshotEpisodes) {
    fingerprintByEpisodeId.set(
      ep.id,
      getScriptEpisodeContentFingerprint({
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        content: ep.content,
      }),
    );
  }

  return input.localRecords.map((record) => {
    const currentFp = fingerprintByEpisodeId.get(record.episodeId);
    if (!currentFp) return record;
    if (
      record.contentFingerprint &&
      record.contentFingerprint !== currentFp
    ) {
      return { ...record, staleUpstream: true };
    }
    return record;
  });
}

function isRevisionConflict(error: unknown): boolean {
  return isRevisionConflictError(error);
}

async function planDownstreamSnapshot(
  projectId: string,
  options?: {
    nextAssets?: Awaited<ReturnType<typeof loadAssetBundleDraft>>;
    nextDesigns?: Awaited<ReturnType<typeof loadEpisodeAssetDesignStore>>;
    nextEpisodes?: WorkspaceSnapshotEpisode[] | null;
    sourceManagementRevision?: number;
  },
): Promise<{
  snapshot: WorkspaceSnapshot;
  sourceManagementRevision: number;
  sourceFingerprint: string;
  parentOperationId: string | null;
  syncDigest: string;
}> {
  const [scriptDraft, assetsDraft, designsStore, prevSnapshot] = await Promise.all([
    loadScriptDraft(projectId).catch(() => null),
    options?.nextAssets !== undefined
      ? Promise.resolve(options.nextAssets)
      : loadAssetBundleDraft(projectId),
    options?.nextDesigns !== undefined
      ? Promise.resolve(options.nextDesigns)
      : loadEpisodeAssetDesignStore(projectId),
    loadWorkspaceSnapshot(projectId),
  ]);

  const episodes: WorkspaceSnapshotEpisode[] =
    options?.nextEpisodes ??
    (scriptDraft?.episodes ?? []).map((ep) => ({
      id: ep.id,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      content: ep.content,
    }));
  const assetsUpdatedAt = assetsDraft?.updatedAt ?? null;
  const designsUpdatedAt = designsStore.updatedAt ?? new Date().toISOString();
  const snapshotDesigns = {
    ...designsStore,
    updatedAt: designsUpdatedAt,
  };
  const sourceFingerprint = computeSourceFingerprint({
    episodes,
    assetsUpdatedAt,
    designsUpdatedAt,
  });
  const sourceManagementRevision =
    options?.sourceManagementRevision ??
    (assetsDraft ? assetBundleDocumentRevision(assetsDraft) : null) ??
    0;
  const parent = null;
  const syncDigest = operationDigest({
    parentOperationId: parent,
    sourceManagementRevision,
    sourceFingerprint,
    targetStore: "workspace",
  });
  const assets = assetsDraft ?? {
    projectId,
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  };
  const snapshot: WorkspaceSnapshot = {
    projectId,
    upstreamRevision: (prevSnapshot?.upstreamRevision ?? 0) + 1,
    syncedAt: new Date().toISOString(),
    sourceFingerprint,
    episodes,
    assets: {
      projectId: assets.projectId,
      characters: assets.characters,
      scenes: assets.scenes,
      props: assets.props,
      audios: assets.audios,
    },
    episodeAssetDesigns: snapshotDesigns,
    syncStatus: "ok",
    syncError: null,
    syncOperationId: null,
    parentOperationId: parent,
    sourceManagementRevision,
    documentRevision: readAssetDocumentRevisionField(prevSnapshot),
  };
  return {
    snapshot,
    sourceManagementRevision,
    sourceFingerprint,
    parentOperationId: parent,
    syncDigest,
  };
}

async function persistPlannedSnapshot(input: {
  projectId: string;
  snapshot: WorkspaceSnapshot;
  syncDigest: string;
}): Promise<WorkspaceSnapshot> {
  const saved = await saveWorkspaceSnapshot(input.snapshot);
  const localDesigns = await loadWorkspaceLocalEpisodeDesigns(input.projectId);
  if (localDesigns.records.length > 0) {
    const nextRecords = markLocalDesignsStale({
      localRecords: localDesigns.records,
      snapshotEpisodes: input.snapshot.episodes,
    });
    const changed = nextRecords.some(
      (rec, idx) => rec.staleUpstream !== localDesigns.records[idx]?.staleUpstream,
    );
    if (changed) {
      await saveWorkspaceLocalEpisodeDesigns({
        ...localDesigns,
        records: nextRecords,
      });
    }
  }
  return saved;
}

export async function syncManagementToWorkspace(
  projectId: string,
): Promise<{
  ok: true;
  revision: number;
  operationId: string | null;
  parentOperationId: string | null;
  sourceManagementRevision: number;
}> {
  let planned = await planDownstreamSnapshot(projectId);
  try {
    const saved = await persistPlannedSnapshot({
      projectId,
      snapshot: planned.snapshot,
      syncDigest: planned.syncDigest,
    });
    return {
      ok: true,
      revision: saved.upstreamRevision,
      operationId: saved.syncOperationId ?? null,
      parentOperationId: planned.parentOperationId,
      sourceManagementRevision: planned.sourceManagementRevision,
    };
  } catch (error) {
    if (!isRevisionConflict(error)) throw error;
    planned = await planDownstreamSnapshot(projectId);
    const saved = await persistPlannedSnapshot({
      projectId,
      snapshot: planned.snapshot,
      syncDigest: planned.syncDigest,
    });
    return {
      ok: true,
      revision: saved.upstreamRevision,
      operationId: saved.syncOperationId ?? null,
      parentOperationId: planned.parentOperationId,
      sourceManagementRevision: planned.sourceManagementRevision,
    };
  }
}

export async function getWorkspaceDownstreamSyncStatus(projectId: string): Promise<{
  syncStatus: WorkspaceSnapshot["syncStatus"];
  syncError: string | null;
  operationId: string | null;
  parentOperationId: string | null;
  sourceManagementRevision: number | null;
  retryPath: string;
}> {
  const snapshot = await loadWorkspaceSnapshot(projectId);
  return {
    syncStatus: snapshot?.syncStatus ?? "ok",
    syncError: snapshot?.syncError ?? null,
    operationId: snapshot?.syncOperationId ?? null,
    parentOperationId: snapshot?.parentOperationId ?? null,
    sourceManagementRevision: snapshot?.sourceManagementRevision ?? null,
    retryPath: `/api/workspace/projects/${encodeURIComponent(projectId)}/downstream-sync`,
  };
}

/** @deprecated Alias kept for script-auto-split callers. */
export const readDurableDownstreamSyncStatus = getWorkspaceDownstreamSyncStatus;

/** Legacy helper — hash of management source for diagnostics. */
export function hashManagementSource(
  projectId: string,
  episodes: WorkspaceSnapshotEpisode[],
  assetsUpdatedAt: string | null,
  designsUpdatedAt: string | null,
): string {
  return createHash("sha256")
    .update(
      computeSourceFingerprint({ episodes, assetsUpdatedAt, designsUpdatedAt }),
    )
    .digest("hex");
}

export async function upsertLocalEpisodeRecord(
  projectId: string,
  record: EpisodeAssetDesignRecord,
): Promise<EpisodeAssetDesignRecord> {
  const store = await loadWorkspaceLocalEpisodeDesigns(projectId);
  const nextStore = upsertEpisodeRecord(store, record);
  await saveWorkspaceLocalEpisodeDesigns(nextStore);
  return record;
}
