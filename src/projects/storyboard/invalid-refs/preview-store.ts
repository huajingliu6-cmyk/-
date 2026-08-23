import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { projectRootDir } from "@/projects/project-storage";
import { stableHash } from "@/projects/storyboard/invalid-refs/name-change-hints";
import type {
  InvalidRefMediaSelection,
  InvalidRefPreviewShotChange,
  InvalidRefScope,
} from "@/projects/storyboard/invalid-refs/types";

export type InvalidRefSnapshot = {
  scope: InvalidRefScope;
  episodeId: string | null;
  store: "management" | "workspace";
  /** Whole production document revision (CAS). */
  productionDocumentRevision: number;
  /** Effective asset bundle document revision for this store. */
  assetDocumentRevision: number;
  /** Shared project consistency revision at preview time. */
  projectConsistencyRevision: number;
  /** episodeId → production/storyboard/shot content digests */
  productions: Record<
    string,
    {
      productionRevision: number;
      storyboardRevision: number | null;
      shotDigests: Record<string, string>;
    }
  >;
  /** assetId → name + allowed/cert media digest */
  assets: Record<
    string,
    {
      name: string;
      kind: string;
      mediaDigest: string;
    }
  >;
  mediaSelections: InvalidRefMediaSelection[];
};

export type InvalidRefPreviewRecord = {
  previewId: string;
  planDigest: string;
  snapshotDigest: string;
  projectId: string;
  userId: string;
  store: "management" | "workspace";
  scope: InvalidRefScope;
  episodeId: string | null;
  mediaSelections: InvalidRefMediaSelection[];
  shotChanges: InvalidRefPreviewShotChange[];
  snapshot: InvalidRefSnapshot;
  createdAt: string;
  expiresAt: string;
};

const PREVIEW_TTL_MS = 60 * 60 * 1000;
const PREVIEW_ID_RE = /^irp_[a-zA-Z0-9]+$/;

function previewDir(projectId: string): string {
  return path.join(
    projectRootDir(projectId),
    "drafts",
    "invalid-ref-previews",
  );
}

function previewPath(projectId: string, previewId: string): string {
  return path.join(previewDir(projectId), `${previewId}.json`);
}

function isInvalidRefPreviewFileName(name: string): boolean {
  if (!name.endsWith(".json")) return false;
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return false;
  }
  const id = name.slice(0, -".json".length);
  return PREVIEW_ID_RE.test(id);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[key] = (v as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return v;
  });
}

export function computePlanDigest(input: {
  scope: InvalidRefScope;
  episodeId: string | null;
  store: "management" | "workspace";
  mediaSelections: InvalidRefMediaSelection[];
  shotChanges: InvalidRefPreviewShotChange[];
  snapshotDigest: string;
}): string {
  return stableHash(
    canonicalJson({
      scope: input.scope,
      episodeId: input.episodeId,
      store: input.store,
      mediaSelections: [...input.mediaSelections].sort((a, b) =>
        a.issueId.localeCompare(b.issueId),
      ),
      shotChanges: input.shotChanges,
      snapshotDigest: input.snapshotDigest,
    }),
  );
}

export function computeSnapshotDigest(snapshot: InvalidRefSnapshot): string {
  return stableHash(canonicalJson(snapshot));
}

export function previewTtlMs(): number {
  return PREVIEW_TTL_MS;
}

/**
 * Conservative GC: only remove expired invalid-ref preview JSON files under
 * drafts/invalid-ref-previews/. Never touches other drafts, blobs, or data/.
 * Failures are logged and do not throw.
 */
export async function purgeExpiredInvalidRefPreviews(
  projectId: string,
  nowMs: number = Date.now(),
): Promise<{ scanned: number; deleted: number }> {
  const dir = previewDir(projectId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code !== "ENOENT") {
      console.warn(
        `[invalid-ref-previews] purge list failed project=${projectId}`,
        error,
      );
    }
    return { scanned: 0, deleted: 0 };
  }

  let scanned = 0;
  let deleted = 0;
  for (const name of entries) {
    if (!isInvalidRefPreviewFileName(name)) continue;
    scanned += 1;
    const full = path.join(dir, name);
    try {
      const raw = await fs.readFile(full, "utf-8");
      const parsed = JSON.parse(raw) as Partial<InvalidRefPreviewRecord>;
      if (
        typeof parsed?.previewId !== "string" ||
        parsed.projectId !== projectId ||
        typeof parsed.expiresAt !== "string" ||
        !PREVIEW_ID_RE.test(parsed.previewId) ||
        `${parsed.previewId}.json` !== name
      ) {
        continue;
      }
      const expiresAt = Date.parse(parsed.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt >= nowMs) continue;
      await fs.unlink(full);
      deleted += 1;
    } catch (error) {
      console.warn(
        `[invalid-ref-previews] purge skip failed project=${projectId} file=${name}`,
        error,
      );
    }
  }
  return { scanned, deleted };
}

async function safePurge(projectId: string): Promise<void> {
  try {
    await purgeExpiredInvalidRefPreviews(projectId);
  } catch (error) {
    console.warn(
      `[invalid-ref-previews] purge unexpected failure project=${projectId}`,
      error,
    );
  }
}

export async function saveInvalidRefPreviewRecord(
  record: Omit<InvalidRefPreviewRecord, "createdAt" | "expiresAt"> & {
    createdAt?: string;
    expiresAt?: string;
  },
): Promise<InvalidRefPreviewRecord> {
  await safePurge(record.projectId);
  const createdAt = record.createdAt ?? new Date().toISOString();
  const expiresAt =
    record.expiresAt ??
    new Date(Date.parse(createdAt) + PREVIEW_TTL_MS).toISOString();
  const full: InvalidRefPreviewRecord = {
    ...record,
    createdAt,
    expiresAt,
  };
  await fs.mkdir(previewDir(full.projectId), { recursive: true });
  const target = previewPath(full.projectId, full.previewId);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(full, null, 2), "utf-8");
  await fs.rename(temp, target);
  return full;
}

export async function loadInvalidRefPreviewRecord(
  projectId: string,
  previewId: string,
): Promise<InvalidRefPreviewRecord | null> {
  await safePurge(projectId);
  try {
    const raw = await fs.readFile(previewPath(projectId, previewId), "utf-8");
    const parsed = JSON.parse(raw) as InvalidRefPreviewRecord;
    if (!parsed?.previewId || parsed.projectId !== projectId) return null;
    if (Date.parse(parsed.expiresAt) < Date.now()) {
      await deleteInvalidRefPreviewRecord(projectId, previewId).catch(
        () => undefined,
      );
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function deleteInvalidRefPreviewRecord(
  projectId: string,
  previewId: string,
): Promise<void> {
  try {
    await fs.unlink(previewPath(projectId, previewId));
  } catch {
    // ignore
  }
}

export function newPreviewId(): string {
  return `irp_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
