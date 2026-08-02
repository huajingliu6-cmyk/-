import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import { listWorkspaceEpisodeAssetDesigns } from "@/projects/workspace-sync/workspace-episode-design-api";
import { guardWorkspaceRemoteData } from "@/projects/workspace-sync/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardWorkspaceRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  const project = guardedProject;
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const guardedItems = await guardWorkspaceRemoteData(async () => {
    await ensureWorkspaceInitialized(projectId);
    return listWorkspaceEpisodeAssetDesigns(projectId);
  });
  if (guardedItems instanceof NextResponse) return guardedItems;
  const items = guardedItems;
  return NextResponse.json({ projectId, items });
}
