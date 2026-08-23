import { promises as fs } from "fs";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { atomicWriteJson } from "@/projects/atomic-write-json";
import { readAssetDocumentRevisionField } from "@/projects/assets/asset-bundle-revision";
import { normalizeAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import {
  workspaceDir,
  workspaceMergeBasePath,
} from "@/projects/workspace-sync/paths";
import type { SyncConflictRecord } from "@/projects/workspace-sync/sync-model";
import { emptyAssetBundle } from "@/projects/workspace-sync/three-way-merge";

export type MergeBaseDocument = {
  projectId: string;
  managementRevision: number;
  workspaceRevision: number;
  syncDigest: string;
  ancestor: ProjectAssetBundle;
  conflicts: SyncConflictRecord[];
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

export function normalizeMergeBase(
  projectId: string,
  raw: unknown,
): MergeBaseDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const ancestor =
    normalizeAssetBundleDraft(projectId, rec.ancestor) ??
    emptyAssetBundle(projectId);
  const conflicts = Array.isArray(rec.conflicts)
    ? (rec.conflicts as SyncConflictRecord[])
    : [];
  return {
    projectId,
    managementRevision:
      typeof rec.managementRevision === "number" ? rec.managementRevision : 0,
    workspaceRevision:
      typeof rec.workspaceRevision === "number" ? rec.workspaceRevision : 0,
    syncDigest: typeof rec.syncDigest === "string" ? rec.syncDigest : "",
    ancestor,
    conflicts,
    updatedAt:
      typeof rec.updatedAt === "string"
        ? rec.updatedAt
        : new Date().toISOString(),
    ...(readAssetDocumentRevisionField(rec) > 0
      ? { documentRevision: readAssetDocumentRevisionField(rec) }
      : {}),
  };
}

export async function loadMergeBase(
  projectId: string,
): Promise<MergeBaseDocument | null> {
  if (isRemoteDataOnly()) return null;
  const raw = await readJson(workspaceMergeBasePath(projectId));
  return raw ? normalizeMergeBase(projectId, raw) : null;
}

export async function saveMergeBaseCas(
  doc: MergeBaseDocument,
): Promise<{ afterRevision: number; result: MergeBaseDocument }> {
  if (isRemoteDataOnly()) {
    throw new Error("REMOTE_MERGE_BASE_UNSUPPORTED");
  }
  await fs.mkdir(workspaceDir(doc.projectId), { recursive: true });
  const target = workspaceMergeBasePath(doc.projectId);
  const disk = await readJson(target);
  const expected = readAssetDocumentRevisionField(doc);
  const diskRev = disk ? readAssetDocumentRevisionField(disk) : 0;
  if (disk !== null && expected !== diskRev) {
    throw new Error("REVISION_CONFLICT");
  }
  const afterRevision = expected + 1;
  const next: MergeBaseDocument = {
    ...doc,
    updatedAt: new Date().toISOString(),
    documentRevision: afterRevision,
  };
  await atomicWriteJson(target, next);
  return { afterRevision, result: next };
}
