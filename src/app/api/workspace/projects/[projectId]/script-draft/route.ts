import { NextResponse } from "next/server";
import { requireWorkspaceProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import { loadWorkspaceSnapshot } from "@/projects/workspace-sync/store";
import { guardWorkspaceRemoteData } from "@/projects/workspace-sync/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/**
 * Workspace read of confirmed formal episodes (downstream snapshot).
 * Script uploads remain management writes; this surface is the synced result.
 */
async function getWorkspaceScriptDraft(
  _request: Request,
  context: RouteContext,
) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const guarded = await guardWorkspaceRemoteData(async () => {
    await ensureWorkspaceInitialized(projectId);
    return loadWorkspaceSnapshot(projectId);
  });
  if (guarded instanceof NextResponse) return guarded;

  return NextResponse.json({
    project: {
      projectId: project.projectId,
      name: project.name,
      status: project.status,
    },
    draft: {
      projectId,
      episodes: guarded?.episodes ?? [],
    },
    downstreamSync: {
      syncStatus: guarded?.syncStatus ?? "ok",
      syncError: guarded?.syncError ?? null,
      operationId: guarded?.syncOperationId ?? null,
    },
  });
}

export function GET(request: Request, context: RouteContext) {
  return getWorkspaceScriptDraft(request, context);
}
