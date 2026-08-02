import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { listUsers } from "@/auth/users";
import { getProjectNameMap } from "@/projects/project-access";
import {
  isApprovalSubmissionStatus,
  listAssetApprovalsForAdmin,
} from "@/projects/assets/approvals/admin-list";
import { guardAssetApprovalRemoteData } from "@/projects/assets/approvals/route-remote-guard";

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function GET(request: Request) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const statusRaw = url.searchParams.get("status")?.trim() ?? "";
  const status =
    statusRaw && isApprovalSubmissionStatus(statusRaw) ? statusRaw : "";

  const guardedResult = await guardAssetApprovalRemoteData(() =>
    listAssetApprovalsForAdmin({
      projectId: url.searchParams.get("projectId")?.trim() ?? "",
      status,
      q: url.searchParams.get("q")?.trim() ?? "",
      page: parsePositiveInt(url.searchParams.get("page"), 1),
      pageSize: parsePositiveInt(url.searchParams.get("pageSize"), 20),
    }),
  );
  if (guardedResult instanceof NextResponse) return guardedResult;
  const result = guardedResult;

  const guardedDirectories = await guardAssetApprovalRemoteData(() =>
    Promise.all([listUsers(), getProjectNameMap()]),
  );
  if (guardedDirectories instanceof NextResponse) return guardedDirectories;
  const [users, projectNames] = guardedDirectories;
  const userMap = new Map(users.map((u) => [u.id, u]));

  const items = result.items.map((sub) => {
    const submitter = userMap.get(sub.submittedByUserId);
    const approver = userMap.get(sub.approverUserId);
    const pendingCount = sub.items.filter((i) => i.status === "pending").length;
    const approvedCount = sub.items.filter((i) => i.status === "approved")
      .length;
    const rejectedCount = sub.items.filter((i) => i.status === "rejected")
      .length;
    return {
      id: sub.id,
      projectId: sub.projectId,
      projectName: projectNames.get(sub.projectId) ?? sub.projectId,
      episodeId: sub.episodeId,
      status: sub.status,
      submittedByUserId: sub.submittedByUserId,
      submitterUsername: submitter?.username ?? "未知用户",
      submitterDisplayName:
        submitter?.displayName ?? submitter?.username ?? "未知用户",
      approverUserId: sub.approverUserId,
      approverUsername: approver?.username ?? "未知用户",
      approverDisplayName:
        approver?.displayName ?? approver?.username ?? "未知用户",
      itemCount: sub.items.length,
      pendingCount,
      approvedCount,
      rejectedCount,
      submittedAt: sub.submittedAt,
      updatedAt: sub.updatedAt,
      completedAt: sub.completedAt,
      items: sub.items.map((item) => ({
        id: item.id,
        category: item.category,
        assetNameSnapshot: item.assetNameSnapshot,
        generatedMediaId: item.generatedMediaId,
        status: item.status,
        approvedByUserId: item.approvedByUserId,
        approvedAt: item.approvedAt,
        rejectedByUserId: item.rejectedByUserId,
        rejectedAt: item.rejectedAt,
        promotedAssetId: item.promotedAssetId,
      })),
    };
  });

  return NextResponse.json({
    items,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    totalPages: result.totalPages,
  });
}
