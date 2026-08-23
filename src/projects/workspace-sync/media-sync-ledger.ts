import { createHash } from "crypto";
import { promises as fs } from "fs";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { atomicWriteJson } from "@/projects/atomic-write-json";
import { wrapWriteFailure } from "@/projects/operation-failed";
import { operationDigest } from "@/projects/stable-digest";
import {
  assetBundleDocumentRevision,
  readAssetDocumentRevisionField,
} from "@/projects/assets/asset-bundle-revision";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraftCas,
  type AssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import { resolveAssetImageFilePath } from "@/projects/assets/asset-image-storage";
import type {
  CharacterAsset,
  ProjectAssetType,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import {
  workspaceDir,
  workspaceMediaSyncLedgerPath,
} from "@/projects/workspace-sync/paths";
import { MEDIA_METADATA_SYNC_TYPE } from "@/projects/workspace-sync/sync-model";
import {
  loadWorkspaceLocalAssets,
  saveWorkspaceLocalAssetsCas,
} from "@/projects/workspace-sync/store";

let testHooks: {
  failAfterAssetRowBeforeRefs?: boolean;
  failBeforeLedgerStamp?: boolean;
} = {};

export function setMediaMetadataRestoreTestHooks(hooks: typeof testHooks): void {
  testHooks = { ...hooks };
}

export function resetMediaMetadataRestoreTestHooks(): void {
  testHooks = {};
}

export type MediaMetadataStatus =
  | "missing_row"
  | "incomplete_refs"
  | "pending"
  | "ok"
  | "failed"
  | "unknown";

export type MediaAssetType = Exclude<ProjectAssetType, "audio">;

export type MediaSyncEntry = {
  storageKey: string;
  projectId: string;
  store: "management" | "workspace";
  assetId: string;
  assetType: MediaAssetType;
  metadataPayload?: unknown;
  metadataDigest: string | null;
  operationId: string | null;
  sourceRevision: number | null;
  targetRevision: number | null;
  metadataStatus: MediaMetadataStatus;
  status: "pending" | "failed" | "unknown" | "ok";
  fileWritten: boolean;
  fileDigest: string | null;
  error: string | null;
  updatedAt: string;
};

export type MediaSyncLedger = {
  projectId: string;
  entries: Record<string, MediaSyncEntry>;
  updatedAt: string;
  documentRevision?: number;
};

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(path, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

export function emptyMediaSyncLedger(projectId: string): MediaSyncLedger {
  return {
    projectId,
    entries: {},
    updatedAt: new Date().toISOString(),
    documentRevision: 0,
  };
}

function normalizeEntry(
  projectId: string,
  storageKey: string,
  raw: MediaSyncEntry | Record<string, unknown>,
): MediaSyncEntry {
  const rec = raw as Record<string, unknown>;
  const status = (
    rec.status === "ok" ||
    rec.status === "pending" ||
    rec.status === "failed" ||
    rec.status === "unknown"
      ? rec.status
      : "pending"
  ) as MediaSyncEntry["status"];
  const metadataStatus = (
    rec.metadataStatus === "missing_row" ||
    rec.metadataStatus === "incomplete_refs" ||
    rec.metadataStatus === "pending" ||
    rec.metadataStatus === "ok" ||
    rec.metadataStatus === "failed" ||
    rec.metadataStatus === "unknown"
      ? rec.metadataStatus
      : status === "ok"
        ? "ok"
        : status === "unknown"
          ? "unknown"
          : status === "failed"
            ? "failed"
            : "pending"
  ) as MediaMetadataStatus;
  const assetType = (
    rec.assetType === "scene" || rec.assetType === "prop" || rec.assetType === "character"
      ? rec.assetType
      : "character"
  ) as MediaAssetType;
  return {
    storageKey: typeof rec.storageKey === "string" ? rec.storageKey : storageKey,
    projectId: typeof rec.projectId === "string" ? rec.projectId : projectId,
    store: rec.store === "workspace" ? "workspace" : "management",
    assetId: typeof rec.assetId === "string" ? rec.assetId : storageKey,
    assetType,
    metadataPayload: rec.metadataPayload,
    metadataDigest: typeof rec.metadataDigest === "string" ? rec.metadataDigest : null,
    operationId: typeof rec.operationId === "string" ? rec.operationId : null,
    sourceRevision: typeof rec.sourceRevision === "number" ? rec.sourceRevision : null,
    targetRevision: typeof rec.targetRevision === "number" ? rec.targetRevision : null,
    metadataStatus,
    status,
    fileWritten: rec.fileWritten === true,
    fileDigest: typeof rec.fileDigest === "string" ? rec.fileDigest : null,
    error: typeof rec.error === "string" ? rec.error : null,
    updatedAt:
      typeof rec.updatedAt === "string" ? rec.updatedAt : new Date().toISOString(),
  };
}

export async function loadMediaSyncLedger(
  projectId: string,
): Promise<MediaSyncLedger> {
  if (isRemoteDataOnly()) return emptyMediaSyncLedger(projectId);
  const raw = await readJson(workspaceMediaSyncLedgerPath(projectId));
  if (!raw || typeof raw !== "object") return emptyMediaSyncLedger(projectId);
  const rec = raw as Record<string, unknown>;
  const entriesIn =
    rec.entries && typeof rec.entries === "object"
      ? (rec.entries as Record<string, MediaSyncEntry>)
      : {};
  const entries: Record<string, MediaSyncEntry> = {};
  for (const [key, value] of Object.entries(entriesIn)) {
    entries[key] = normalizeEntry(projectId, key, value);
  }
  return {
    projectId,
    entries,
    updatedAt:
      typeof rec.updatedAt === "string"
        ? rec.updatedAt
        : new Date().toISOString(),
    documentRevision: readAssetDocumentRevisionField(rec),
  };
}

async function writeLedger(
  ledger: MediaSyncLedger,
): Promise<MediaSyncLedger> {
  await fs.mkdir(workspaceDir(ledger.projectId), { recursive: true });
  const afterRevision = (ledger.documentRevision ?? 0) + 1;
  const next = {
    ...ledger,
    updatedAt: new Date().toISOString(),
    documentRevision: afterRevision,
  };
  await atomicWriteJson(workspaceMediaSyncLedgerPath(ledger.projectId), next);
  return next;
}

export function metadataPayloadDigest(payload: unknown): string {
  return operationDigest({
    kind: "media-metadata-payload",
    payload: payload ?? null,
  });
}

export async function hashMediaFile(
  projectId: string,
  storageKey: string,
): Promise<string | null> {
  const filePath = resolveAssetImageFilePath(projectId, storageKey);
  if (!filePath) return null;
  try {
    const buffer = await fs.readFile(filePath);
    return createHash("sha256").update(buffer).digest("hex");
  } catch {
    return null;
  }
}

export async function recordMediaFileWritten(input: {
  projectId: string;
  storageKey: string;
  assetId: string;
  store: "management" | "workspace";
  assetType?: MediaAssetType;
  metadataPayload?: unknown;
  fileDigest?: string | null;
  operationId?: string | null;
  sourceRevision?: number | null;
  targetRevision?: number | null;
  metadataStatus?: MediaMetadataStatus;
}): Promise<MediaSyncEntry> {
  const ledger = await loadMediaSyncLedger(input.projectId);
  const current = ledger.entries[input.storageKey];
  const metadataDigest = input.metadataPayload
    ? metadataPayloadDigest(input.metadataPayload)
    : current?.metadataDigest ?? null;
  const entry: MediaSyncEntry = {
    storageKey: input.storageKey,
    projectId: input.projectId,
    store: input.store,
    assetId: input.assetId,
    assetType: input.assetType ?? current?.assetType ?? "character",
    metadataPayload: input.metadataPayload ?? current?.metadataPayload,
    metadataDigest,
    status: "pending",
    metadataStatus: input.metadataStatus ?? "pending",
    fileWritten: true,
    operationId: input.operationId ?? current?.operationId ?? null,
    fileDigest: input.fileDigest ?? current?.fileDigest ?? null,
    sourceRevision: input.sourceRevision ?? current?.sourceRevision ?? null,
    targetRevision: input.targetRevision ?? current?.targetRevision ?? null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
  ledger.entries[input.storageKey] = entry;
  await writeLedger(ledger);
  return entry;
}

export async function markMediaMetadataSynced(input: {
  projectId: string;
  storageKey: string;
}): Promise<void> {
  const ledger = await loadMediaSyncLedger(input.projectId);
  const current = ledger.entries[input.storageKey];
  if (!current) return;
  ledger.entries[input.storageKey] = {
    ...current,
    status: "ok",
    metadataStatus: "ok",
    error: null,
    updatedAt: new Date().toISOString(),
  };
  await writeLedger(ledger);
}

export async function markMediaMetadataFailed(input: {
  projectId: string;
  storageKey: string;
  operationId: string;
  error: string;
  unknown?: boolean;
  metadataStatus?: MediaMetadataStatus;
  metadataPayload?: unknown;
  assetType?: MediaAssetType;
  assetId?: string;
  store?: "management" | "workspace";
  fileDigest?: string | null;
  sourceRevision?: number | null;
}): Promise<MediaSyncEntry> {
  const ledger = await loadMediaSyncLedger(input.projectId);
  const current = ledger.entries[input.storageKey] ?? {
    storageKey: input.storageKey,
    projectId: input.projectId,
    assetId: input.assetId ?? input.storageKey,
    store: input.store ?? "management",
    assetType: input.assetType ?? "character",
    metadataPayload: input.metadataPayload,
    metadataDigest: input.metadataPayload
      ? metadataPayloadDigest(input.metadataPayload)
      : null,
    status: "failed" as const,
    metadataStatus: "failed" as const,
    fileWritten: true,
    operationId: input.operationId,
    fileDigest: input.fileDigest ?? null,
    sourceRevision: input.sourceRevision ?? null,
    targetRevision: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
  const entry: MediaSyncEntry = {
    ...current,
    projectId: input.projectId,
    assetId: input.assetId ?? current.assetId,
    store: input.store ?? current.store,
    assetType: input.assetType ?? current.assetType,
    metadataPayload: input.metadataPayload ?? current.metadataPayload,
    metadataDigest: input.metadataPayload
      ? metadataPayloadDigest(input.metadataPayload)
      : current.metadataDigest,
    fileDigest: input.fileDigest ?? current.fileDigest,
    sourceRevision: input.sourceRevision ?? current.sourceRevision,
    status: input.unknown ? "unknown" : "failed",
    metadataStatus:
      input.metadataStatus ?? (input.unknown ? "unknown" : "missing_row"),
    fileWritten: true,
    operationId: input.operationId,
    error: input.error,
    updatedAt: new Date().toISOString(),
  };
  ledger.entries[input.storageKey] = entry;
  await writeLedger(ledger);
  return entry;
}

export async function mediaFileExists(
  projectId: string,
  storageKey: string,
): Promise<boolean | null> {
  const filePath = resolveAssetImageFilePath(projectId, storageKey);
  if (!filePath) return null;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function assertReusableWrittenFile(input: {
  projectId: string;
  storageKey: string;
}): Promise<true> {
  const exists = await mediaFileExists(input.projectId, input.storageKey);
  if (exists === true) return true;
  wrapWriteFailure(
    new Error(
      exists === false
        ? "无法确认已写入文件是否仍可用"
        : "无法确认文件/元数据状态",
    ),
  );
}

export function mediaSyncDigest(input: {
  projectId: string;
  storageKey: string;
  fileDigest?: string | null;
  metadataDigest?: string | null;
}): string {
  return operationDigest({
    kind: MEDIA_METADATA_SYNC_TYPE,
    projectId: input.projectId,
    storageKey: input.storageKey,
    fileDigest: input.fileDigest ?? "",
    metadataDigest: input.metadataDigest ?? "",
  });
}

export function deriveMediaSyncOperationId(input: {
  projectId: string;
  storageKey: string;
  fileDigest?: string | null;
  metadataDigest?: string | null;
}): string {
  return `op_${mediaSyncDigest(input)}`;
}

type BundleListKey = "characters" | "scenes" | "props";

function listKeyFor(assetType: MediaAssetType): BundleListKey {
  if (assetType === "scene") return "scenes";
  if (assetType === "prop") return "props";
  return "characters";
}

function findAsset(
  bundle: AssetBundleDraft | null,
  assetType: MediaAssetType,
  assetId: string,
): Record<string, unknown> | null {
  if (!bundle) return null;
  const list = bundle[listKeyFor(assetType)] as Array<Record<string, unknown>>;
  return list.find((item) => item.id === assetId) ?? null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function inspectMediaAssetCompleteness(input: {
  asset: Record<string, unknown> | null;
  storageKey: string;
  assetType: MediaAssetType;
  payload?: unknown;
}): {
  exists: boolean;
  complete: boolean;
  missing: string[];
} {
  if (!input.asset) {
    return { exists: false, complete: false, missing: ["asset-row"] };
  }
  const missing: string[] = [];
  const approved = stringList(input.asset.approvedMediaIds);
  const imageFileName = input.asset.imageFileName;
  const primaryMediaId = input.asset.primaryMediaId;
  if (imageFileName !== input.storageKey && primaryMediaId !== input.storageKey) {
    missing.push("media-ref");
  }
  if (!approved.includes(input.storageKey)) {
    missing.push("approvedMediaIds");
  }
  const payload = (input.payload && typeof input.payload === "object"
    ? (input.payload as Record<string, unknown>)
    : null);
  if (payload?.approvalProvenance && !input.asset.approvalProvenance) {
    missing.push("approvalProvenance");
  }
  if (payload?.videoRefSafety && !input.asset.videoRefSafety) {
    missing.push("videoRefSafety");
  }
  if (input.assetType === "character") {
    const safetyMap = input.asset.mediaVideoRefSafety;
    const hasSafety =
      safetyMap &&
      typeof safetyMap === "object" &&
      !Array.isArray(safetyMap) &&
      input.storageKey in (safetyMap as Record<string, unknown>);
    if ((payload?.videoRefSafety || payload?.mediaVideoRefSafety) && !hasSafety) {
      missing.push("mediaVideoRefSafety");
    }
  }
  return { exists: true, complete: missing.length === 0, missing };
}

function restoreAssetRow(input: {
  storageKey: string;
  assetId: string;
  assetType: MediaAssetType;
  projectId: string;
  payload: unknown;
  existing: Record<string, unknown> | null;
}): CharacterAsset | SceneAsset | PropAsset {
  const payload =
    input.payload && typeof input.payload === "object"
      ? (input.payload as Record<string, unknown>)
      : {};
  const base = { ...(input.existing ?? payload), ...payload };
  const approved = new Set(stringList(base.approvedMediaIds));
  approved.add(input.storageKey);
  const restored: Record<string, unknown> = {
    ...base,
    id: input.assetId,
    projectId: input.projectId,
    imageFileName:
      typeof base.imageFileName === "string" ? base.imageFileName : input.storageKey,
    imageObjectUrl: null,
    primaryMediaId:
      typeof base.primaryMediaId === "string" || base.primaryMediaId === null
        ? (base.primaryMediaId as string | null)
        : input.storageKey,
    approvedMediaIds: [...approved],
  };
  if (input.assetType === "character") {
    const safetyMap =
      restored.mediaVideoRefSafety && typeof restored.mediaVideoRefSafety === "object"
        ? { ...(restored.mediaVideoRefSafety as Record<string, unknown>) }
        : {};
    if (restored.videoRefSafety && !safetyMap[input.storageKey]) {
      safetyMap[input.storageKey] = restored.videoRefSafety;
    }
    restored.mediaVideoRefSafety = safetyMap;
  }
  return restored as CharacterAsset | SceneAsset | PropAsset;
}

async function loadStoreBundle(
  projectId: string,
  store: "management" | "workspace",
): Promise<AssetBundleDraft | null> {
  return store === "workspace"
    ? loadWorkspaceLocalAssets(projectId).catch(() => null)
    : loadAssetBundleDraft(projectId).catch(() => null);
}

async function saveStoreBundle(
  store: "management" | "workspace",
  bundle: AssetBundleDraft,
): Promise<AssetBundleDraft> {
  return store === "workspace"
    ? saveWorkspaceLocalAssetsCas(bundle, { skipNameChangeHints: true })
    : saveAssetBundleDraftCas(bundle, { skipNameChangeHints: true });
}

function throwRestoreFailed(message: string): never {
  wrapWriteFailure(new Error(message));
}

export async function restoreMediaMetadataFromLedger(input: {
  projectId: string;
  storageKey: string;
  operationId: string;
}): Promise<{ afterRevision: number; result: MediaSyncLedger }> {
  const ledger = await loadMediaSyncLedger(input.projectId);
  const entry = ledger.entries[input.storageKey];
  if (!entry) {
    throwRestoreFailed("无法确认媒体 ledger 条目");
  }

  const exists = await mediaFileExists(input.projectId, entry.storageKey);
  if (exists !== true) {
    throwRestoreFailed("无法确认文件/元数据状态，禁止删除或重复写入");
  }
  const liveDigest = await hashMediaFile(input.projectId, entry.storageKey);
  if (!liveDigest || !entry.fileDigest || liveDigest !== entry.fileDigest) {
    throwRestoreFailed("文件摘要不匹配或状态无法确认，已保留文件且不重复上传");
  }

  const bundle = await loadStoreBundle(input.projectId, entry.store);
  const existing = findAsset(bundle, entry.assetType, entry.assetId);
  const inspect = inspectMediaAssetCompleteness({
    asset: existing,
    storageKey: entry.storageKey,
    assetType: entry.assetType,
    payload: entry.metadataPayload,
  });

  if (inspect.complete && existing) {
    ledger.entries[entry.storageKey] = {
      ...entry,
      status: "ok",
      metadataStatus: "ok",
      error: null,
      targetRevision: bundle ? (assetBundleDocumentRevision(bundle) ?? entry.targetRevision) : entry.targetRevision,
      updatedAt: new Date().toISOString(),
    };
    const saved = await writeLedger(ledger);
    return { afterRevision: saved.documentRevision ?? 0, result: saved };
  }

  if (!existing && !entry.metadataPayload) {
    throwRestoreFailed("无法确认资产行，禁止删除或重复上传");
  }

  const restored = restoreAssetRow({
    storageKey: entry.storageKey,
    assetId: entry.assetId,
    assetType: entry.assetType,
    projectId: input.projectId,
    payload: entry.metadataPayload,
    existing,
  });
  const key = listKeyFor(entry.assetType);
  const currentBundle =
    bundle ??
    ({
      projectId: input.projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [],
      updatedAt: new Date().toISOString(),
      documentRevision: 0,
    } as AssetBundleDraft);

  const writeBundle = async (asset: CharacterAsset | SceneAsset | PropAsset) => {
    const live =
      (await loadStoreBundle(input.projectId, entry.store)) ?? currentBundle;
    const list = [...(live[key] as unknown[])] as Array<Record<string, unknown>>;
    const index = list.findIndex((item) => item.id === entry.assetId);
    if (index >= 0) list[index] = asset as unknown as Record<string, unknown>;
    else list.push(asset as unknown as Record<string, unknown>);
    const nextBundle = {
      ...live,
      [key]: list,
    } as AssetBundleDraft;
    return saveStoreBundle(entry.store, nextBundle);
  };

  let rowOnly = restored;
  if (!existing) {
    const incomplete = restoreAssetRow({
      storageKey: entry.storageKey,
      assetId: entry.assetId,
      assetType: entry.assetType,
      projectId: input.projectId,
      payload: { ...(entry.metadataPayload as object), approvalProvenance: null },
      existing: null,
    });
    rowOnly = {
      ...incomplete,
      approvedMediaIds: [entry.storageKey],
      approvalProvenance: null,
      videoRefSafety: null,
      mediaVideoRefSafety: {},
    } as typeof restored;
    await writeBundle(rowOnly);
    if (testHooks.failAfterAssetRowBeforeRefs) {
      testHooks.failAfterAssetRowBeforeRefs = false;
      throw new Error("TEST_AFTER_ASSET_ROW_BEFORE_REFS");
    }
  }

  const savedBundle = await writeBundle(restored);
  if (testHooks.failBeforeLedgerStamp) {
    testHooks.failBeforeLedgerStamp = false;
    throw new Error("TEST_BEFORE_LEDGER_STAMP");
  }
  const afterInspect = inspectMediaAssetCompleteness({
    asset: findAsset(savedBundle, entry.assetType, entry.assetId),
    storageKey: entry.storageKey,
    assetType: entry.assetType,
    payload: entry.metadataPayload,
  });
  if (!afterInspect.complete) {
    ledger.entries[entry.storageKey] = {
      ...entry,
      status: "failed",
      metadataStatus: existing ? "incomplete_refs" : "missing_row",
      targetRevision: assetBundleDocumentRevision(savedBundle),
      error: `资产 metadata 仍不完整: ${afterInspect.missing.join(",")}`,
      updatedAt: new Date().toISOString(),
    };
    const saved = await writeLedger(ledger);
    return { afterRevision: saved.documentRevision ?? 0, result: saved };
  }

  ledger.entries[entry.storageKey] = {
    ...entry,
    status: "ok",
    metadataStatus: "ok",
    error: null,
    targetRevision: assetBundleDocumentRevision(savedBundle),
    sourceRevision: entry.sourceRevision ?? assetBundleDocumentRevision(currentBundle),
    updatedAt: new Date().toISOString(),
  };
  const saved = await writeLedger(ledger);
  return { afterRevision: saved.documentRevision ?? 0, result: saved };
}

export async function commitMediaMetadataRestore(input: {
  projectId: string;
  storageKey: string;
  store: "management" | "workspace";
  operationId?: string | null;
}): Promise<MediaSyncLedger> {
  const ledger = await loadMediaSyncLedger(input.projectId);
  const entry = ledger.entries[input.storageKey];
  if (!entry || entry.store !== input.store) {
    return ledger;
  }
  const operationId =
    input.operationId?.trim() ||
    entry.operationId ||
    deriveMediaSyncOperationId({
      projectId: input.projectId,
      storageKey: input.storageKey,
      fileDigest: entry.fileDigest,
      metadataDigest: entry.metadataDigest,
    });
  const restored = await restoreMediaMetadataFromLedger({
    projectId: input.projectId,
    storageKey: input.storageKey,
    operationId,
  });
  return restored.result;
}

export function mediaSyncLabel(status: MediaSyncEntry["status"] | MediaMetadataStatus): string {
  if (
    status === "pending" ||
    status === "failed" ||
    status === "missing_row" ||
    status === "incomplete_refs"
  ) {
    return "待补齐资产 metadata";
  }
  if (status === "unknown") return "待补齐资产 metadata（状态未知）";
  return "已同步";
}
