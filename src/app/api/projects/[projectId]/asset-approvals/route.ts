import { NextResponse } from "next/server";
import { requireActualProjectOwner } from "@/auth/require-access";
import { loadAssetApprovalsFile } from "@/projects/assets/approvals/store";
import { getProjectRecord } from "@/projects/project-access";
import { guardAssetApprovalRemoteData } from "@/projects/assets/approvals/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
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

  const url = new URL(request.url);
  const episodeId = url.searchParams.get("episodeId")?.trim() ?? "";
  const guardedFile = await guardAssetApprovalRemoteData(() =>
    loadAssetApprovalsFile(projectId),
  );
  if (guardedFile instanceof NextResponse) return guardedFile;
  const file = guardedFile;
  let submissions = file.submissions.filter((s) => s.projectId === projectId);
  if (episodeId) {
    submissions = submissions.filter((s) => s.episodeId === episodeId);
  }

  return NextResponse.json({
    projectId,
    projectName: project.name,
    submissions,
  });
}
