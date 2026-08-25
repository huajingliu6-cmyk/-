import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { handleConfirmEpisodeRosterSelection } from "@/projects/assets/extraction/http";
import { guardWorkspaceRemoteData } from "@/projects/workspace-sync/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string; taskId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId, taskId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;
  const guardedProject = await guardWorkspaceRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  if (!guardedProject) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const guarded = await guardWorkspaceRemoteData(() =>
    handleConfirmEpisodeRosterSelection(projectId, taskId, body),
  );
  if (guarded instanceof NextResponse) return guarded;
  return guarded;
}
