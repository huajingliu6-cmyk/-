import { NextResponse } from "next/server";
import { requireActualProjectOwner } from "@/auth/require-access";
import { approveAssetApprovalItems } from "@/projects/assets/approvals/approve";
import { getProjectRecord } from "@/projects/project-access";
import { guardAssetApprovalRemoteData } from "@/projects/assets/approvals/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string; submissionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId, submissionId } = await context.params;
  const gated = await requireActualProjectOwner(projectId);
  if (!gated.ok) return gated.response;


  const guardedProject = await guardAssetApprovalRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  const project = guardedProject;
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const itemIds = Array.isArray(raw?.itemIds) ? raw.itemIds : null;
  if (!itemIds) {
    return NextResponse.json(
      { error: "缺少 itemIds", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const guardedResult = await guardAssetApprovalRemoteData(() =>
    approveAssetApprovalItems({
      projectId,
      submissionId,
      itemIds: itemIds.filter((id): id is string => typeof id === "string"),
      approverUserId: gated.user.id,
    }),
  );
  if (guardedResult instanceof NextResponse) return guardedResult;
  const result = guardedResult;

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status ?? 400 },
    );
  }

  return NextResponse.json({
    submission: result.submission,
    approvedCount: result.approvedCount,
    pendingCount: result.pendingCount,
    promoted: result.promoted,
  });
}
