import { promises as fs } from "fs";
import path from "path";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { projectRootDir } from "@/projects/project-storage";
import {
  loadAssetApprovalsRemoteValue,
  saveAssetApprovalsRemote,
} from "@/projects/assets/approvals/remote-store";
import type {
  AssetApprovalItem,
  AssetApprovalSubmission,
  AssetApprovalsFile,
  ApprovalCategory,
  ApprovalItemStatus,
  ApprovalSubmissionStatus,
} from "@/projects/assets/approvals/types";

function approvalsPath(projectId: string): string {
  return path.join(projectRootDir(projectId), "asset-approvals.json");
}

async function ensureProjectDir(projectId: string) {
  await fs.mkdir(projectRootDir(projectId), { recursive: true });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asCategory(v: unknown): ApprovalCategory | null {
  return v === "character" || v === "scene" || v === "prop" ? v : null;
}

function asSubmissionStatus(v: unknown): ApprovalSubmissionStatus {
  if (
    v === "partially_approved" ||
    v === "approved" ||
    v === "pending" ||
    v === "rejected"
  ) {
    return v;
  }
  return "pending";
}

function asItemStatus(v: unknown): ApprovalItemStatus {
  if (v === "approved" || v === "rejected") return v;
  return "pending";
}

function parseItem(raw: unknown): AssetApprovalItem | null {
  if (!isRecord(raw)) return null;
  const category = asCategory(raw.category);
  if (
    typeof raw.id !== "string" ||
    typeof raw.submissionId !== "string" ||
    !category ||
    typeof raw.assetDesignItemId !== "string" ||
    typeof raw.assetNameSnapshot !== "string" ||
    typeof raw.generatedMediaId !== "string" ||
    typeof raw.generatedAtSnapshot !== "string" ||
    typeof raw.storageKey !== "string"
  ) {
    return null;
  }
  return {
    id: raw.id,
    submissionId: raw.submissionId,
    category,
    assetDesignItemId: raw.assetDesignItemId,
    assetNameSnapshot: raw.assetNameSnapshot,
    generatedMediaId: raw.generatedMediaId,
    generatedAtSnapshot: raw.generatedAtSnapshot,
    storageKey: raw.storageKey,
    promptSnapshot:
      typeof raw.promptSnapshot === "string" ? raw.promptSnapshot : null,
    voiceIdSnapshot:
      typeof raw.voiceIdSnapshot === "string" ? raw.voiceIdSnapshot : null,
    voiceNameSnapshot:
      typeof raw.voiceNameSnapshot === "string" ? raw.voiceNameSnapshot : null,
    status: asItemStatus(raw.status),
    approvedByUserId:
      typeof raw.approvedByUserId === "string" ? raw.approvedByUserId : null,
    approvedAt: typeof raw.approvedAt === "string" ? raw.approvedAt : null,
    rejectedByUserId:
      typeof raw.rejectedByUserId === "string" ? raw.rejectedByUserId : null,
    rejectedAt: typeof raw.rejectedAt === "string" ? raw.rejectedAt : null,
    promotedAssetId:
      typeof raw.promotedAssetId === "string" ? raw.promotedAssetId : null,
  };
}

function parseSubmission(raw: unknown): AssetApprovalSubmission | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== "string" ||
    typeof raw.projectId !== "string" ||
    typeof raw.episodeId !== "string" ||
    typeof raw.submittedByUserId !== "string" ||
    typeof raw.approverUserId !== "string" ||
    typeof raw.createdAt !== "string" ||
    typeof raw.updatedAt !== "string" ||
    typeof raw.submittedAt !== "string" ||
    !Array.isArray(raw.items)
  ) {
    return null;
  }
  const items = raw.items
    .map(parseItem)
    .filter((i): i is AssetApprovalItem => i != null);
  return {
    id: raw.id,
    projectId: raw.projectId,
    episodeId: raw.episodeId,
    submittedByUserId: raw.submittedByUserId,
    approverUserId: raw.approverUserId,
    status: asSubmissionStatus(raw.status),
    items,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    submittedAt: raw.submittedAt,
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : null,
    revision:
      typeof raw.revision === "number" && Number.isFinite(raw.revision)
        ? raw.revision
        : 1,
    idempotencyKey:
      typeof raw.idempotencyKey === "string" ? raw.idempotencyKey : null,
  };
}

export function emptyApprovalsFile(now = new Date().toISOString()): AssetApprovalsFile {
  return {
    version: 1,
    revision: 0,
    updatedAt: now,
    submissions: [],
  };
}

export function normalizeAssetApprovalsFile(raw: unknown): AssetApprovalsFile {
  if (!isRecord(raw) || !Array.isArray(raw.submissions)) {
    return emptyApprovalsFile();
  }
  return {
    version: 1,
    revision:
      typeof raw.revision === "number" && Number.isFinite(raw.revision)
        ? raw.revision
        : 0,
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : new Date().toISOString(),
    submissions: raw.submissions
      .map(parseSubmission)
      .filter((submission): submission is AssetApprovalSubmission =>
        submission != null,
      ),
  };
}

export async function loadAssetApprovalsFile(
  projectId: string,
): Promise<AssetApprovalsFile> {
  if (isRemoteDataOnly()) {
    return normalizeAssetApprovalsFile(
      await loadAssetApprovalsRemoteValue(projectId),
    );
  }
  try {
    const raw = await fs.readFile(approvalsPath(projectId), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeAssetApprovalsFile(parsed);
  } catch {
    return emptyApprovalsFile();
  }
}

export async function saveAssetApprovalsFile(
  projectId: string,
  file: AssetApprovalsFile,
): Promise<AssetApprovalsFile> {
  const next: AssetApprovalsFile = {
    ...file,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  if (isRemoteDataOnly()) return saveAssetApprovalsRemote(projectId, next);
  await ensureProjectDir(projectId);
  const target = approvalsPath(projectId);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(next, null, 2), "utf-8");
  await fs.rename(temp, target);
  return next;
}

export function computeSubmissionStatus(
  items: AssetApprovalItem[],
): ApprovalSubmissionStatus {
  if (items.length === 0) return "pending";
  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;
  const rejected = items.filter((i) => i.status === "rejected").length;
  if (pending > 0) {
    if (approved === 0 && rejected === 0) return "pending";
    return "partially_approved";
  }
  if (approved === items.length) return "approved";
  if (rejected === items.length) return "rejected";
  return "partially_approved";
}

export function findSubmission(
  file: AssetApprovalsFile,
  submissionId: string,
): AssetApprovalSubmission | null {
  return file.submissions.find((s) => s.id === submissionId) ?? null;
}

export function listOpenMediaIds(file: AssetApprovalsFile): Set<string> {
  const ids = new Set<string>();
  for (const sub of file.submissions) {
    if (sub.status === "approved") continue;
    for (const item of sub.items) {
      if (item.status === "pending") {
        ids.add(item.generatedMediaId);
      }
    }
  }
  return ids;
}

export function listApprovedMediaIds(file: AssetApprovalsFile): Set<string> {
  const ids = new Set<string>();
  for (const sub of file.submissions) {
    for (const item of sub.items) {
      if (item.status === "approved") {
        ids.add(item.generatedMediaId);
      }
    }
  }
  return ids;
}

export function findSubmissionByIdempotencyKey(
  file: AssetApprovalsFile,
  key: string,
): AssetApprovalSubmission | null {
  if (!key) return null;
  return file.submissions.find((s) => s.idempotencyKey === key) ?? null;
}
