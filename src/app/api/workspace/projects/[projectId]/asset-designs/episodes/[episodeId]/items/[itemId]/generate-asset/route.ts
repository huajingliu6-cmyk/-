import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import { getWorkspaceEpisodeAssetDesignDetail } from "@/projects/workspace-sync/workspace-episode-design-api";
import { guardWorkspaceRemoteData } from "@/projects/workspace-sync/route-remote-guard";
import { enqueueDesignAssetGenerate } from "@/projects/assets/image-generation/enqueue-design-asset";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; itemId: string }>;
};

/**
 * @deprecated Sync generate-asset removed in P1.2 — always returns async img_* job.
 */
async function post(request: Request, context: RouteContext) {
  const { projectId, episodeId, itemId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  await ensureWorkspaceInitialized(projectId);
  const detail = await getWorkspaceEpisodeAssetDesignDetail(
    projectId,
    episodeId,
  );
  if (!detail.ok) {
    return NextResponse.json(
      { error: detail.message, code: detail.code },
      { status: 404 },
    );
  }
  const item = detail.record.items.find((i) => i.id === itemId);
  if (!item) {
    return NextResponse.json({ error: "资产项不存在" }, { status: 404 });
  }

  return enqueueDesignAssetGenerate({
    request,
    projectId,
    episodeId,
    itemId,
    actorUserId: gated.user.id,
    scope: "workspace",
    item,
  });
}

export function POST(request: Request, context: RouteContext) {
  return guardWorkspaceRemoteData(() => post(request, context));
}
