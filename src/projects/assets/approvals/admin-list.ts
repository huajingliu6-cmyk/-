import { listProjectRecords } from "@/projects/project-access";
import { loadAssetApprovalsFile } from "@/projects/assets/approvals/store";
import type {
  ApprovalSubmissionStatus,
  AssetApprovalSubmission,
} from "@/projects/assets/approvals/types";

export type AdminAssetApprovalFilters = {
  projectId?: string;
  status?: ApprovalSubmissionStatus | "";
  q?: string;
  page?: number;
  pageSize?: number;
};

export type AdminAssetApprovalListResult = {
  items: AssetApprovalSubmission[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const STATUSES = new Set<ApprovalSubmissionStatus>([
  "pending",
  "partially_approved",
  "approved",
  "rejected",
]);

export function isApprovalSubmissionStatus(
  value: string,
): value is ApprovalSubmissionStatus {
  return STATUSES.has(value as ApprovalSubmissionStatus);
}

/**
 * Cross-project scan of asset-approvals.json for system admin audit history.
 * Sorted by submittedAt desc. Filters applied in memory (MVP).
 */
export async function listAssetApprovalsForAdmin(
  filters: AdminAssetApprovalFilters = {},
): Promise<AdminAssetApprovalListResult> {
  const pageSize = Math.min(50, Math.max(1, filters.pageSize ?? 20));
  const page = Math.max(1, filters.page ?? 1);

  const projects = filters.projectId
    ? [{ projectId: filters.projectId }]
    : await listProjectRecords();

  const all: AssetApprovalSubmission[] = [];
  for (const project of projects) {
    const file = await loadAssetApprovalsFile(project.projectId);
    all.push(...file.submissions);
  }

  const status = filters.status?.trim() ?? "";
  const q = filters.q?.trim().toLowerCase() ?? "";

  const filtered = all.filter((sub) => {
    if (status && sub.status !== status) return false;
    if (q) {
      const hay = [
        sub.id,
        sub.projectId,
        sub.episodeId,
        sub.submittedByUserId,
        sub.approverUserId,
        ...sub.items.map((i) => i.assetNameSnapshot),
      ]
        .join("\n")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const ta = a.submittedAt || a.createdAt || "";
    const tb = b.submittedAt || b.createdAt || "";
    return tb.localeCompare(ta);
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return { items, page: safePage, pageSize, total, totalPages };
}
