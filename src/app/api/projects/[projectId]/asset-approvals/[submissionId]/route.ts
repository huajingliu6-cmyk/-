import { NextResponse } from "next/server";
import { requireActualProjectOwner } from "@/auth/require-access";
import {
  findSubmission,
  loadAssetApprovalsFile,
} from "@/projects/assets/approvals/store";
import { getProjectRecord } from "@/projects/project-access";
import { guardAssetApprovalRemoteData } from "@/projects/assets/approvals/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string; submissionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
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

  const guardedFile = await guardAssetApprovalRemoteData(() =>
    loadAssetApprovalsFile(projectId),
  );
  if (guardedFile instanceof NextResponse) return guardedFile;
  const file = guardedFile;
  const submission = findSubmission(file, submissionId);
  if (!submission || submission.projectId !== projectId) {
    return NextResponse.json(
      {
        error: "审批单不存在",
        code: "APPROVAL_SUBMISSION_NOT_FOUND",
      },
      { status: 404 },
    );
  }

  const pendingCount = submission.items.filter((i) => i.status === "pending")
    .length;
  const approvedCount = submission.items.filter(
    (i) => i.status === "approved",
  ).length;

  return NextResponse.json({
    projectId,
    projectName: project.name,
    submission,
    pendingCount,
    approvedCount,
  });
}
