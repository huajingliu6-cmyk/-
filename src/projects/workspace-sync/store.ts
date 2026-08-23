import { promises as fs } from "fs";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  normalizeAssetBundleDraft,
  sanitizeAssetBundleForPersist,
  type AssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import {
  ASSET_REVISION_CONFLICT,
  ASSET_REVISION_REQUIRED,
  attachAssetBundleRevision,
  assetBundleDocumentRevision,
  carryAssetBundleRevision,
  readAssetDocumentRevisionField,
} from "@/projects/assets/asset-bundle-revision";
import { atomicWriteJson } from "@/projects/atomic-write-json";
import { wrapWriteFailure } from "@/projects/operation-failed";
import {
  emptyEpisodeAssetDesignStore,
  normalizeEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/store";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import type { ProjectEpisodeAssetDesignStore } from "@/projects/assets/episode-design/types";
import {
  workspaceAssetsPath,
  workspaceDir,
  workspaceEpisodeAssetDesignsPath,
  workspaceSnapshotPath,
} from "@/projects/workspace-sync/paths";
import type {
  WorkspaceLocalStore,
  WorkspaceSnapshot,
  WorkspaceSnapshotEpisode,
} from "@/projects/workspace-sync/types";
import {
  getWorkspaceLocalAssetsMaxBytes,
  WorkspaceMaterializeTooLargeError,
} from "@/projects/workspace-sync/workspace-local-assets-quota-config";
import {
  loadWorkspaceAssetsRemoteDocument,
  loadWorkspaceEpisodeDesignsRemoteDocument,
  loadWorkspaceEpisodeDesignsRemoteValue,
  loadWorkspaceSnapshotRemoteValue,
  saveWorkspaceAssetsRemote,
  saveWorkspaceEpisodeDesignsRemote,
  saveWorkspaceSnapshotRemote,
} from "@/projects/workspace-sync/remote-store";

export { WorkspaceMaterializeTooLargeError } from "@/projects/workspace-sync/workspace-local-assets-quota-config";

async function ensureWorkspace(projectId: string) {
  await fs.mkdir(workspaceDir(projectId), { recursive: true });
}

async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(path, "utf-8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function emptySnapshot(projectId: string): WorkspaceSnapshot {
  const now = new Date().toISOString();
  return {
    projectId,
    upstreamRevision: 0,
    syncedAt: now,
    sourceFingerprint: null,
    episodes: [],
    assets: {
      projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    },
    episodeAssetDesigns: emptyEpisodeAssetDesignStore(projectId),
    syncStatus: "ok",
    syncError: null,
  };
}

function normalizeSnapshotEpisodes(raw: unknown): WorkspaceSnapshotEpisode[] {
  if (!Array.isArray(raw)) return [];
  const episodes: WorkspaceSnapshotEpisode[] = [];
  for (const item of raw) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { id?: unknown }).id !== "string"
    ) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    episodes.push({
      id: rec.id as string,
      episodeNumber:
        typeof rec.episodeNumber === "number" && Number.isFinite(rec.episodeNumber)
          ? rec.episodeNumber
          : 0,
      title: typeof rec.title === "string" ? rec.title : "",
      content: typeof rec.content === "string" ? rec.content : "",
    });
  }
  return episodes;
}

export function normalizeWorkspaceSnapshot(
  projectId: string,
  raw: unknown,
): WorkspaceSnapshot {
  if (typeof raw !== "object" || raw === null) {
    return emptySnapshot(projectId);
  }
  const rec = raw as Record<string, unknown>;
  const assetsRaw = normalizeAssetBundleDraft(projectId, rec.assets);
  const designsRaw = normalizeEpisodeAssetDesignStore(
    projectId,
    rec.episodeAssetDesigns,
  );
  return {
    projectId,
    upstreamRevision:
      typeof rec.upstreamRevision === "number" &&
      Number.isFinite(rec.upstreamRevision)
        ? rec.upstreamRevision
        : 0,
    syncedAt:
      typeof rec.syncedAt === "string"
        ? rec.syncedAt
        : new Date().toISOString(),
    sourceFingerprint:
      typeof rec.sourceFingerprint === "string" ? rec.sourceFingerprint : null,
    episodes: normalizeSnapshotEpisodes(rec.episodes),
    documentRevision: readAssetDocumentRevisionField(rec),
    assets: assetsRaw ?? {
      projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    },
    episodeAssetDesigns: designsRaw,
    syncStatus:
      rec.syncStatus === "failed"
        ? "failed"
        : rec.syncStatus === "pending"
          ? "pending"
          : rec.syncStatus === "unknown"
            ? "unknown"
            : "ok",
    syncError: typeof rec.syncError === "string" ? rec.syncError : null,
    syncOperationId:
      typeof rec.syncOperationId === "string" ? rec.syncOperationId : null,
    parentOperationId:
      typeof rec.parentOperationId === "string" ? rec.parentOperationId : null,
    sourceManagementRevision:
      typeof rec.sourceManagementRevision === "number"
        ? rec.sourceManagementRevision
        : null,
  };
}

export async function loadWorkspaceSnapshot(
  projectId: string,
): Promise<WorkspaceSnapshot | null> {
  if (isRemoteDataOnly()) {
    const raw = await loadWorkspaceSnapshotRemoteValue(projectId);
    return raw === null ? null : normalizeWorkspaceSnapshot(projectId, raw);
  }
  const raw = await readJsonFile(workspaceSnapshotPath(projectId));
  if (raw === null) return null;
  return normalizeWorkspaceSnapshot(projectId, raw);
}

export async function saveWorkspaceSnapshotCas(
  snapshot: WorkspaceSnapshot,
): Promise<{ afterRevision: number; result: WorkspaceSnapshot }> {
  const next: WorkspaceSnapshot = {
    ...snapshot,
    syncedAt: snapshot.syncedAt || new Date().toISOString(),
    parentOperationId: snapshot.parentOperationId ?? null,
    sourceManagementRevision: snapshot.sourceManagementRevision ?? null,
  };
  const expectedRevision = readAssetDocumentRevisionField(next);
  if (isRemoteDataOnly()) {
    const saved = await saveWorkspaceSnapshotRemote(snapshot.projectId, next);
    const afterRevision =
      readAssetDocumentRevisionField(saved) || expectedRevision + 1;
    return {
      afterRevision,
      result: { ...next, documentRevision: afterRevision },
    };
  }
  await ensureWorkspace(snapshot.projectId);
  const target = workspaceSnapshotPath(snapshot.projectId);
  const disk = await readJsonFile(target);
  const diskRev = disk ? readAssetDocumentRevisionField(disk) : 0;
  if (disk !== null && expectedRevision !== diskRev) {
    throw new Error("REVISION_CONFLICT");
  }
  const afterRevision = expectedRevision + 1;
  const toWrite = {
    ...next,
    documentRevision: afterRevision,
  };
  await atomicWriteJson(target, toWrite);
  return { afterRevision, result: { ...next, documentRevision: afterRevision } };
}

export async function saveWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  const next: WorkspaceSnapshot = {
    ...snapshot,
    syncedAt: new Date().toISOString(),
  };
  const saved = await saveWorkspaceSnapshotCas(next);
  return saved.result;
}

export async function loadWorkspaceLocalAssets(
  projectId: string,
): Promise<AssetBundleDraft | null> {
  if (isRemoteDataOnly()) {
    const document = await loadWorkspaceAssetsRemoteDocument(projectId);
    if (!document) return null;
    const draft = normalizeAssetBundleDraft(projectId, document.value);
    return draft
      ? attachAssetBundleRevision(draft, document.revision)
      : null;
  }
  const raw = await readJsonFile(workspaceAssetsPath(projectId));
  if (raw === null) return null;
  const draft = normalizeAssetBundleDraft(projectId, raw);
  return draft
    ? attachAssetBundleRevision(draft, readAssetDocumentRevisionField(raw))
    : null;
}

/**
 * Client JSON never carries the in-memory revision Symbol. Prefer an explicit
 * revision on `source` (CAS); otherwise rebase onto the live document head.
 */
function bindRevisionForWorkspacePersist(
  target: AssetBundleDraft,
  source: ProjectAssetBundle,
  live: AssetBundleDraft | null,
): void {
  const fromSource = assetBundleDocumentRevision(source);
  if (fromSource !== null) {
    attachAssetBundleRevision(target, fromSource);
    return;
  }
  if (live) {
    carryAssetBundleRevision(live, target);
    return;
  }
  attachAssetBundleRevision(target, 0);
}

export async function saveWorkspaceLocalAssets(
  bundle: ProjectAssetBundle,
): Promise<AssetBundleDraft> {
  const previous = await loadWorkspaceLocalAssets(bundle.projectId).catch(
    () => null,
  );
  const sanitized = sanitizeAssetBundleForPersist(bundle);
  const draft: AssetBundleDraft = {
    ...sanitized,
    updatedAt: new Date().toISOString(),
  };
  bindRevisionForWorkspacePersist(draft, bundle, previous);

  const payload = JSON.stringify(draft);
  const byteLength = Buffer.byteLength(payload, "utf8");
  const assetCount =
    draft.characters.length +
    draft.scenes.length +
    draft.props.length +
    draft.audios.length;
  const maxBytes = getWorkspaceLocalAssetsMaxBytes();
  if (byteLength > maxBytes) {
    throw new WorkspaceMaterializeTooLargeError(
      `工作台本地资产体积过大（${byteLength} > ${maxBytes} bytes），已拒绝写入`,
      { byteLength, maxBytes, assetCount },
    );
  }

  if (previous) {
    const { collectNameChangesFromBundles, recordAssetNameChanges } =
      await import("@/projects/storyboard/invalid-refs/name-change-hints");
    const changes = collectNameChangesFromBundles({
      previous,
      next: draft,
    });
    if (changes.length > 0) {
      await recordAssetNameChanges({
        projectId: bundle.projectId,
        changes,
      }).catch(() => undefined);
    }
  }

  const saved = await saveWorkspaceLocalAssetsCas(draft, {
    skipNameChangeHints: true,
  });
  try {
    const { loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const management = await loadAssetBundleDraft(bundle.projectId).catch(
      () => null,
    );
    if (management) {
      const { runBidirectionalMerge } = await import(
        "@/projects/workspace-sync/bidirectional-merge"
      );
      await runBidirectionalMerge(bundle.projectId);
    }
  } catch (error) {
    wrapWriteFailure(error);
  }
  return saved;
}

export async function saveWorkspaceLocalAssetsCas(
  bundle: ProjectAssetBundle,
  options?: { skipNameChangeHints?: boolean },
): Promise<AssetBundleDraft> {
  const live = await loadWorkspaceLocalAssets(bundle.projectId).catch(
    () => null,
  );
  const previous = options?.skipNameChangeHints ? null : live;
  const sanitized = sanitizeAssetBundleForPersist(bundle);
  const draft: AssetBundleDraft = {
    ...sanitized,
    updatedAt: new Date().toISOString(),
  };
  bindRevisionForWorkspacePersist(draft, bundle, live);

  if (previous) {
    const { collectNameChangesFromBundles, recordAssetNameChanges } =
      await import("@/projects/storyboard/invalid-refs/name-change-hints");
    const changes = collectNameChangesFromBundles({
      previous,
      next: draft,
    });
    if (changes.length > 0) {
      await recordAssetNameChanges({
        projectId: bundle.projectId,
        changes,
      }).catch(() => undefined);
    }
  }

  const payload = JSON.stringify(draft);
  const byteLength = Buffer.byteLength(payload, "utf8");
  const assetCount =
    draft.characters.length +
    draft.scenes.length +
    draft.props.length +
    draft.audios.length;
  console.info(
    `[workspace-local-assets] project=${bundle.projectId} bytes=${byteLength} assets=${assetCount} characters=${draft.characters.length} scenes=${draft.scenes.length} props=${draft.props.length}`,
  );
  const maxBytes = getWorkspaceLocalAssetsMaxBytes();
  if (byteLength > maxBytes) {
    throw new WorkspaceMaterializeTooLargeError(
      `工作台本地资产体积过大（${byteLength} > ${maxBytes} bytes），已拒绝写入`,
      { byteLength, maxBytes, assetCount },
    );
  }

  if (isRemoteDataOnly()) {
    const carried = assetBundleDocumentRevision(draft);
    const current = await loadWorkspaceAssetsRemoteDocument(bundle.projectId);
    if (current !== null) {
      if (carried === null) {
        throw new Error(ASSET_REVISION_REQUIRED);
      }
      if (carried !== current.revision) {
        throw new Error(ASSET_REVISION_CONFLICT);
      }
    } else if (carried !== null && carried !== 0) {
      throw new Error(ASSET_REVISION_CONFLICT);
    }
    const expectedRevision = current === null ? 0 : carried!;
    const saved = await saveWorkspaceAssetsRemote(
      bundle.projectId,
      draft,
      expectedRevision,
    );
    const normalized =
      normalizeAssetBundleDraft(bundle.projectId, saved) ?? draft;
    return attachAssetBundleRevision(normalized, expectedRevision + 1);
  }

  await ensureWorkspace(bundle.projectId);
  const target = workspaceAssetsPath(bundle.projectId);
  let diskRaw: unknown | null = null;
  try {
    diskRaw = await readJsonFile(target);
  } catch {
    diskRaw = null;
  }
  const diskRev = diskRaw ? readAssetDocumentRevisionField(diskRaw) : 0;
  const carried = assetBundleDocumentRevision(draft);

  if (diskRaw !== null) {
    if (carried === null) {
      throw new Error(ASSET_REVISION_REQUIRED);
    }
    if (carried !== diskRev) {
      throw new Error(ASSET_REVISION_CONFLICT);
    }
  } else if (carried !== null && carried !== 0) {
    throw new Error(ASSET_REVISION_CONFLICT);
  }

  const nextRev = diskRaw === null ? 1 : diskRev + 1;
  const toWrite = {
    ...draft,
    documentRevision: nextRev,
  };
  await atomicWriteJson(target, toWrite);
  return attachAssetBundleRevision(draft, nextRev);
}

export async function loadWorkspaceLocalEpisodeDesigns(
  projectId: string,
): Promise<ProjectEpisodeAssetDesignStore> {
  if (isRemoteDataOnly()) {
    const raw = await loadWorkspaceEpisodeDesignsRemoteValue(projectId);
    return raw === null
      ? emptyEpisodeAssetDesignStore(projectId)
      : normalizeEpisodeAssetDesignStore(projectId, raw);
  }
  const raw = await readJsonFile(workspaceEpisodeAssetDesignsPath(projectId));
  if (raw === null) {
    return emptyEpisodeAssetDesignStore(projectId);
  }
  return normalizeEpisodeAssetDesignStore(projectId, raw);
}

export async function loadWorkspaceLocalEpisodeDesignsDocument(
  projectId: string,
): Promise<{
  value: ProjectEpisodeAssetDesignStore;
  remoteRevision: number | null;
}> {
  if (isRemoteDataOnly()) {
    const document = await loadWorkspaceEpisodeDesignsRemoteDocument(projectId);
    return {
      value:
        document === null
          ? emptyEpisodeAssetDesignStore(projectId)
          : normalizeEpisodeAssetDesignStore(projectId, document.value),
      remoteRevision: document?.revision ?? 0,
    };
  }
  return {
    value: await loadWorkspaceLocalEpisodeDesigns(projectId),
    remoteRevision: null,
  };
}

export async function saveWorkspaceLocalEpisodeDesigns(
  store: ProjectEpisodeAssetDesignStore,
  options?: { expectedRemoteRevision?: number },
): Promise<ProjectEpisodeAssetDesignStore> {
  const next: ProjectEpisodeAssetDesignStore = {
    ...store,
    updatedAt: new Date().toISOString(),
  };
  const expectedRevision =
    options?.expectedRemoteRevision ?? readAssetDocumentRevisionField(next);
  if (isRemoteDataOnly()) {
    return saveWorkspaceEpisodeDesignsRemote(
      store.projectId,
      next,
      expectedRevision,
    );
  }
  await ensureWorkspace(store.projectId);
  const target = workspaceEpisodeAssetDesignsPath(store.projectId);
  const disk = await readJsonFile(target);
  const diskRev = disk ? readAssetDocumentRevisionField(disk) : 0;
  if (disk !== null && expectedRevision !== diskRev) {
    throw new Error("REVISION_CONFLICT");
  }
  const afterRevision = expectedRevision + 1;
  const saved = { ...next, documentRevision: afterRevision };
  await atomicWriteJson(target, saved);
  return saved;
}

export async function loadWorkspaceLocalStore(
  projectId: string,
): Promise<WorkspaceLocalStore> {
  const [assets, episodeAssetDesigns] = await Promise.all([
    loadWorkspaceLocalAssets(projectId),
    loadWorkspaceLocalEpisodeDesigns(projectId),
  ]);
  const now = new Date().toISOString();
  return {
    projectId,
    assets: assets ?? {
      projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [],
      updatedAt: now,
    },
    episodeAssetDesigns,
    overrides: {},
    updatedAt: now,
  };
}
