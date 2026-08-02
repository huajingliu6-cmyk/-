import { promises as fs } from "fs";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  normalizeAssetBundleDraft,
  sanitizeAssetBundleForPersist,
  type AssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
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
  loadWorkspaceAssetsRemoteValue,
  loadWorkspaceEpisodeDesignsRemoteValue,
  loadWorkspaceSnapshotRemoteValue,
  saveWorkspaceAssetsRemote,
  saveWorkspaceEpisodeDesignsRemote,
  saveWorkspaceSnapshotRemote,
} from "@/projects/workspace-sync/remote-store";

async function ensureWorkspace(projectId: string) {
  await fs.mkdir(workspaceDir(projectId), { recursive: true });
}

async function atomicWriteJson(target: string, data: unknown) {
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(temp, target);
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
    assets: assetsRaw ?? {
      projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    },
    episodeAssetDesigns: designsRaw,
    syncStatus: rec.syncStatus === "failed" ? "failed" : "ok",
    syncError: typeof rec.syncError === "string" ? rec.syncError : null,
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

export async function saveWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  const next: WorkspaceSnapshot = {
    ...snapshot,
    syncedAt: new Date().toISOString(),
  };
  if (isRemoteDataOnly()) {
    return saveWorkspaceSnapshotRemote(snapshot.projectId, next);
  }
  await ensureWorkspace(snapshot.projectId);
  await atomicWriteJson(workspaceSnapshotPath(snapshot.projectId), next);
  return next;
}

export async function loadWorkspaceLocalAssets(
  projectId: string,
): Promise<AssetBundleDraft | null> {
  if (isRemoteDataOnly()) {
    const raw = await loadWorkspaceAssetsRemoteValue(projectId);
    return raw === null ? null : normalizeAssetBundleDraft(projectId, raw);
  }
  const raw = await readJsonFile(workspaceAssetsPath(projectId));
  return normalizeAssetBundleDraft(projectId, raw);
}

export async function saveWorkspaceLocalAssets(
  bundle: ProjectAssetBundle,
): Promise<AssetBundleDraft> {
  const sanitized = sanitizeAssetBundleForPersist(bundle);
  const draft: AssetBundleDraft = {
    ...sanitized,
    updatedAt: new Date().toISOString(),
  };
  if (isRemoteDataOnly()) {
    return saveWorkspaceAssetsRemote(bundle.projectId, draft);
  }
  await ensureWorkspace(bundle.projectId);
  await atomicWriteJson(workspaceAssetsPath(bundle.projectId), draft);
  return draft;
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

export async function saveWorkspaceLocalEpisodeDesigns(
  store: ProjectEpisodeAssetDesignStore,
): Promise<ProjectEpisodeAssetDesignStore> {
  const next: ProjectEpisodeAssetDesignStore = {
    ...store,
    updatedAt: new Date().toISOString(),
  };
  if (isRemoteDataOnly()) {
    return saveWorkspaceEpisodeDesignsRemote(store.projectId, next);
  }
  await ensureWorkspace(store.projectId);
  await atomicWriteJson(
    workspaceEpisodeAssetDesignsPath(store.projectId),
    next,
  );
  return next;
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
