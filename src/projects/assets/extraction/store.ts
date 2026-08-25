import { promises as fs } from "fs";
import path from "path";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { projectRootDir } from "@/projects/project-storage";
import { readAssetDocumentRevisionField } from "@/projects/assets/asset-bundle-revision";
import { atomicWriteJson } from "@/projects/atomic-write-json";
import {
  loadProjectAssetData,
  saveProjectAssetDataWithRetry,
} from "@/projects/assets/remote-project-asset-data";
import type {
  AssetDetailTaskItem,
  AssetExtractionProgress,
  AssetExtractionResult,
  AssetExtractionStore,
  AssetExtractionTask,
  AssetExtractionTaskStatus,
  AssetExtractionStage,
  AssetExtractionVersion,
  AssetManualOverride,
  AssetRosterItem,
  ExtractedAsset,
  ExtractedAssetDraft,
} from "@/projects/assets/extraction/types";
import { isBlockingExtractionStatus } from "@/projects/assets/extraction/types";
import type { EpisodeAssetDesignAssetType } from "@/projects/assets/episode-design/types";

function draftsDir(projectId: string): string {
  return path.join(projectRootDir(projectId), "drafts");
}

function storePath(projectId: string): string {
  return path.join(draftsDir(projectId), "asset-extraction.json");
}

async function ensureDrafts(projectId: string) {
  await fs.mkdir(draftsDir(projectId), { recursive: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asAssetType(value: unknown): EpisodeAssetDesignAssetType {
  if (
    value === "character" ||
    value === "scene" ||
    value === "prop" ||
    value === "audio"
  ) {
    return value;
  }
  return "character";
}

function parseRosterItem(raw: unknown): AssetRosterItem | null {
  if (!isRecord(raw)) return null;
  const name = asString(raw.name);
  const type = asAssetType(raw.type);
  const assetKey = asString(raw.assetKey) || `${type}:${name}`;
  if (!name || !assetKey) return null;
  return {
    assetKey,
    type,
    name,
    aliases: Array.isArray(raw.aliases)
      ? raw.aliases.filter((item): item is string => typeof item === "string")
      : [],
    episodeIds: Array.isArray(raw.episodeIds)
      ? raw.episodeIds.filter((item): item is string => typeof item === "string")
      : [],
    evidenceRefs: Array.isArray(raw.evidenceRefs)
      ? raw.evidenceRefs.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function parseDetailItem(raw: unknown): AssetDetailTaskItem | null {
  if (!isRecord(raw)) return null;
  const assetKey = asString(raw.assetKey);
  const name = asString(raw.name);
  if (!assetKey || !name) return null;
  const status = asString(raw.status, "pending");
  return {
    assetKey,
    name,
    status:
      status === "pending" ||
      status === "running" ||
      status === "completed" ||
      status === "failed" ||
      status === "terminal_failed"
        ? status
        : "pending",
    attempt: asNumber(raw.attempt, 0),
    batchIndex:
      typeof raw.batchIndex === "number" && Number.isFinite(raw.batchIndex)
        ? raw.batchIndex
        : undefined,
    errorCode: asString(raw.errorCode) || undefined,
    errorMessage: asString(raw.errorMessage) || undefined,
  };
}

function normalizeTaskStatus(raw: string): AssetExtractionTaskStatus {
  if (raw === "generating" || raw === "queued" || raw === "discovering") {
    return "discovering_roster";
  }
  if (raw === "applying") return "extracting_details";
  if (raw === "retrying_failed") return "retrying_failed_once";
  if (raw === "succeeded" || raw === "partial_completed") return "completed";
  if (
    raw === "discovering_roster" ||
    raw === "merging_roster" ||
    raw === "awaiting_roster_selection" ||
    raw === "extracting_details" ||
    raw === "retrying_failed_once" ||
    raw === "saving" ||
    raw === "completed" ||
    raw === "failed"
  ) {
    return raw;
  }
  return "failed";
}

function normalizeTaskStage(
  raw: string,
  status: AssetExtractionTaskStatus,
): AssetExtractionStage {
  if (
    raw === "discovering_roster" ||
    raw === "merging_roster" ||
    raw === "extracting_details" ||
    raw === "retrying_failed_once" ||
    raw === "saving" ||
    raw === "complete"
  ) {
    return raw;
  }
  if (raw === "discovering") return "discovering_roster";
  if (raw === "retrying_failed") return "retrying_failed_once";
  if (status === "awaiting_roster_selection") return "merging_roster";
  if (status === "merging_roster") return "merging_roster";
  if (status === "extracting_details") return "extracting_details";
  if (status === "retrying_failed_once") return "retrying_failed_once";
  if (status === "saving") return "saving";
  if (status === "completed" || status === "failed") return "complete";
  return "discovering_roster";
}

function parseProgress(raw: unknown): AssetExtractionProgress | undefined {
  if (!isRecord(raw)) return undefined;
  const phaseRaw = asString(raw.phase);
  const phase: AssetExtractionProgress["phase"] =
    phaseRaw === "discovering_roster" ||
    phaseRaw === "merging_roster" ||
    phaseRaw === "awaiting_roster_selection" ||
    phaseRaw === "extracting_details" ||
    phaseRaw === "retrying_failed_once" ||
    phaseRaw === "saving" ||
    phaseRaw === "completed"
      ? phaseRaw
      : "discovering_roster";
  const roster = isRecord(raw.roster) ? raw.roster : {};
  const details = isRecord(raw.details) ? raw.details : {};
  const retryRound = asNumber(details.retryRound, 0) === 1 ? 1 : 0;
  return {
    phase,
    estimatedProgress: Math.max(
      0,
      Math.min(100, asNumber(raw.estimatedProgress, 0)),
    ),
    roster: {
      scannedChunks: Math.max(0, asNumber(roster.scannedChunks, 0)),
      totalChunks: Math.max(1, asNumber(roster.totalChunks, 1)),
      discoveredCount: Math.max(0, asNumber(roster.discoveredCount, 0)),
    },
    details: {
      totalAssets: Math.max(0, asNumber(details.totalAssets, 0)),
      completedAssets: Math.max(0, asNumber(details.completedAssets, 0)),
      runningBatches: Math.max(0, asNumber(details.runningBatches, 0)),
      completedBatches: Math.max(0, asNumber(details.completedBatches, 0)),
      totalBatches: Math.max(0, asNumber(details.totalBatches, 0)),
      retryRound,
    },
  };
}

function asDraft(value: unknown): ExtractedAssetDraft {
  return isRecord(value) ? (value as ExtractedAssetDraft) : ({} as ExtractedAssetDraft);
}

function parseAsset(raw: unknown): ExtractedAsset | null {
  if (!isRecord(raw)) return null;
  const identity = asString(raw.identity);
  const name = asString(raw.name);
  if (!identity || !name) return null;
  return {
    identity,
    assetType: asAssetType(raw.assetType),
    name,
    draft: asDraft(raw.draft),
    originalAiFingerprint: asString(raw.originalAiFingerprint),
    sourceEpisodeIds: Array.isArray(raw.sourceEpisodeIds)
      ? raw.sourceEpisodeIds.filter((id): id is string => typeof id === "string")
      : [],
    libraryAssetId: asNullableString(raw.libraryAssetId),
  };
}

function parseTask(raw: unknown): AssetExtractionTask | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const projectId = asString(raw.projectId);
  const taskKey = asString(raw.taskKey);
  if (!id || !projectId || !taskKey) return null;
  const status = normalizeTaskStatus(asString(raw.status, "failed"));
  const stage = normalizeTaskStage(asString(raw.stage, "discovering_roster"), status);
  const scope = raw.scope === "episode" ? "episode" : "all";
  return {
    id,
    projectId,
    taskKey,
    sourceFingerprint: asString(raw.sourceFingerprint),
    scope,
    episodeId: asNullableString(raw.episodeId),
    modelKey: asString(raw.modelKey, "deepseek-v4-pro"),
    status,
    stage,
    estimatedProgress: Math.max(0, Math.min(100, asNumber(raw.estimatedProgress, 0))),
    revision: asNumber(raw.revision, 0),
    errorMessage: asNullableString(raw.errorMessage),
    versionId: asNullableString(raw.versionId),
    createdAt: asString(raw.createdAt, new Date().toISOString()),
    updatedAt: asString(raw.updatedAt, new Date().toISOString()),
    roster: Array.isArray(raw.roster)
      ? raw.roster
          .map(parseRosterItem)
          .filter((item): item is AssetRosterItem => item !== null)
      : [],
    detailItems: Array.isArray(raw.detailItems)
      ? raw.detailItems
          .map(parseDetailItem)
          .filter((item): item is AssetDetailTaskItem => item !== null)
      : [],
    failedAssetQueue: Array.isArray(raw.failedAssetQueue)
      ? raw.failedAssetQueue.filter((item): item is string => typeof item === "string")
      : [],
    selectedAssetKeys: Array.isArray(raw.selectedAssetKeys)
      ? raw.selectedAssetKeys.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : undefined,
    rosterCompletedChunkIds: Array.isArray(raw.rosterCompletedChunkIds)
      ? raw.rosterCompletedChunkIds.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    progress: parseProgress(raw.progress),
    rosterChunksTotal:
      typeof raw.rosterChunksTotal === "number" &&
      Number.isFinite(raw.rosterChunksTotal) &&
      raw.rosterChunksTotal > 0
        ? Math.floor(raw.rosterChunksTotal)
        : undefined,
    runnerId: asNullableString(raw.runnerId),
    runnerLeaseUntil: asNullableString(raw.runnerLeaseUntil),
    heartbeatAt: asNullableString(raw.heartbeatAt),
  };
}

function parseVersion(raw: unknown): AssetExtractionVersion | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const projectId = asString(raw.projectId);
  if (!id || !projectId) return null;
  const status = asString(raw.status) as AssetExtractionVersion["status"];
  return {
    id,
    projectId,
    sourceFingerprint: asString(raw.sourceFingerprint),
    status:
      status === "active" || status === "candidate" || status === "archived"
        ? status
        : "archived",
    modelKey: asString(raw.modelKey, "deepseek-v4-pro"),
    attempt: asNumber(raw.attempt, 1),
    createdAt: asString(raw.createdAt, new Date().toISOString()),
  };
}

function parseResult(raw: unknown): AssetExtractionResult | null {
  if (!isRecord(raw)) return null;
  const versionId = asString(raw.versionId);
  if (!versionId) return null;
  return {
    versionId,
    scope: raw.scope === "episode" ? "episode" : "all",
    episodeId: asNullableString(raw.episodeId),
    assets: Array.isArray(raw.assets)
      ? raw.assets.map(parseAsset).filter((a): a is ExtractedAsset => a !== null)
      : [],
  };
}

function parseOverride(raw: unknown): AssetManualOverride | null {
  if (!isRecord(raw)) return null;
  const assetIdentity = asString(raw.assetIdentity);
  const versionId = asString(raw.versionId);
  const projectId = asString(raw.projectId);
  if (!assetIdentity || !versionId || !projectId) return null;
  return {
    projectId,
    versionId,
    assetIdentity,
    fields: isRecord(raw.fields) ? raw.fields : {},
    originalAiFingerprint: asString(raw.originalAiFingerprint),
    updatedAt: asString(raw.updatedAt, new Date().toISOString()),
  };
}

export function emptyAssetExtractionStore(
  projectId: string,
): AssetExtractionStore {
  return {
    projectId,
    migratedFromLegacy: false,
    tasks: [],
    versions: [],
    results: [],
    overrides: [],
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeAssetExtractionStore(
  projectId: string,
  raw: unknown,
): AssetExtractionStore {
  if (!isRecord(raw)) return emptyAssetExtractionStore(projectId);
  return {
    projectId,
    migratedFromLegacy: raw.migratedFromLegacy === true,
    tasks: Array.isArray(raw.tasks)
      ? raw.tasks.map(parseTask).filter((t): t is AssetExtractionTask => t !== null)
      : [],
    versions: Array.isArray(raw.versions)
      ? raw.versions
          .map(parseVersion)
          .filter((v): v is AssetExtractionVersion => v !== null)
      : [],
    results: Array.isArray(raw.results)
      ? raw.results
          .map(parseResult)
          .filter((r): r is AssetExtractionResult => r !== null)
      : [],
    overrides: Array.isArray(raw.overrides)
      ? raw.overrides
          .map(parseOverride)
          .filter((o): o is AssetManualOverride => o !== null)
      : [],
    updatedAt: asString(raw.updatedAt, new Date().toISOString()),
    documentRevision: readAssetDocumentRevisionField(raw) || undefined,
  };
}

const projectLocks = new Map<string, Promise<unknown>>();

export async function withAssetExtractionLock<T>(
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = projectLocks.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  projectLocks.set(
    projectId,
    previous.catch(() => undefined).then(() => gate),
  );
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (projectLocks.get(projectId) === gate) {
      projectLocks.delete(projectId);
    }
  }
}

export async function loadAssetExtractionStore(
  projectId: string,
): Promise<AssetExtractionStore> {
  if (isRemoteDataOnly()) {
    const raw = (await loadProjectAssetData("asset-extraction", projectId)).value;
    return raw === null
      ? emptyAssetExtractionStore(projectId)
      : normalizeAssetExtractionStore(projectId, raw);
  }
  try {
    const raw = await fs.readFile(storePath(projectId), "utf-8");
    return normalizeAssetExtractionStore(projectId, JSON.parse(raw) as unknown);
  } catch {
    return emptyAssetExtractionStore(projectId);
  }
}

export async function saveAssetExtractionStore(
  store: AssetExtractionStore,
): Promise<AssetExtractionStore> {
  const next: AssetExtractionStore = {
    ...store,
    updatedAt: new Date().toISOString(),
  };
  if (isRemoteDataOnly()) {
    return saveProjectAssetDataWithRetry(
      "asset-extraction",
      store.projectId,
      () => next,
    );
  }
  await ensureDrafts(store.projectId);
  const target = storePath(store.projectId);
  const expectedRevision = readAssetDocumentRevisionField(next);
  let diskRev = 0;
  let diskExists = false;
  try {
    const raw = JSON.parse(await fs.readFile(target, "utf-8")) as unknown;
    diskExists = true;
    diskRev = readAssetDocumentRevisionField(raw);
  } catch {
    diskExists = false;
  }
  if (diskExists && expectedRevision !== diskRev) {
    throw new Error("REVISION_CONFLICT");
  }
  const saved: AssetExtractionStore = {
    ...next,
    documentRevision: expectedRevision + 1,
  };
  await atomicWriteJson(target, saved);
  return saved;
}

export async function mutateAssetExtractionStore(
  projectId: string,
  build: (store: AssetExtractionStore) => AssetExtractionStore,
): Promise<AssetExtractionStore> {
  return withAssetExtractionLock(projectId, async () => {
    if (isRemoteDataOnly()) {
      return saveProjectAssetDataWithRetry(
        "asset-extraction",
        projectId,
        (current) =>
          build(
            current
              ? normalizeAssetExtractionStore(projectId, current)
              : emptyAssetExtractionStore(projectId),
          ),
      );
    }
    const current = await loadAssetExtractionStore(projectId);
    return saveAssetExtractionStore(build(current));
  });
}

export function getActiveVersion(
  store: AssetExtractionStore,
): AssetExtractionVersion | null {
  return store.versions.find((version) => version.status === "active") ?? null;
}

export function getCandidateVersion(
  store: AssetExtractionStore,
): AssetExtractionVersion | null {
  return store.versions.find((version) => version.status === "candidate") ?? null;
}

export function getLiveTask(
  store: AssetExtractionStore,
  taskKey?: string,
): AssetExtractionTask | null {
  // Include awaiting_roster_selection so another extract cannot start mid-pick.
  const live = store.tasks.filter((task) =>
    isBlockingExtractionStatus(task.status),
  );
  if (taskKey) {
    return live.find((task) => task.taskKey === taskKey) ?? null;
  }
  return (
    [...live].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

/** Most relevant open/recent task across episode and all-assets scopes. */
export function getOpenOrLatestExtractionTask(
  store: AssetExtractionStore,
): AssetExtractionTask | null {
  const open = store.tasks
    .filter((task) => isBlockingExtractionStatus(task.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (open[0]) return open[0];
  return getLatestTask(store);
}

export function getLatestTask(
  store: AssetExtractionStore,
  taskKey?: string,
): AssetExtractionTask | null {
  const live = getLiveTask(store, taskKey);
  if (live) return live;
  const pool = taskKey
    ? store.tasks.filter((task) => task.taskKey === taskKey)
    : store.tasks;
  return (
    [...pool].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

export function resultsForVersion(
  store: AssetExtractionStore,
  versionId: string,
): AssetExtractionResult[] {
  return store.results.filter((result) => result.versionId === versionId);
}

export function lastSuccessfulModelKey(store: AssetExtractionStore): string | null {
  const succeeded = [...store.tasks]
    .filter(
      (task) =>
        (task.status === "completed" || task.status === "succeeded") &&
        task.modelKey,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return succeeded[0]?.modelKey ?? getActiveVersion(store)?.modelKey ?? null;
}
