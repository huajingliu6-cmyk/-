import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { runGenerateDesignPromptBatchPost } from "@/projects/assets/episode-design/run-generate-design-prompt-batch-route";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import {
  getWorkspaceEpisodeAssetDesignDetail,
  patchWorkspaceItemDesignPrompt,
} from "@/projects/workspace-sync/workspace-episode-design-api";
import { guardWorkspaceRemoteData } from "@/projects/workspace-sync/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

async function post(request: Request, context: RouteContext) {
  const { projectId, episodeId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  await ensureWorkspaceInitialized(projectId);

  return runGenerateDesignPromptBatchPost({
    request,
    projectId,
    episodeId,
    userId: gated.user.id,
    loadDetail: () => getWorkspaceEpisodeAssetDesignDetail(projectId, episodeId),
    patchItem: async ({ itemId, designPrompt }) => {
      const detail = await getWorkspaceEpisodeAssetDesignDetail(
        projectId,
        episodeId,
      );
      if (!detail.ok) return detail;
      return patchWorkspaceItemDesignPrompt({
        projectId,
        episodeId,
        itemId,
        fingerprint: detail.currentFingerprint,
        designPrompt,
      });
    },
  });
}

export function POST(request: Request, context: RouteContext) {
  return guardWorkspaceRemoteData(() => post(request, context));
}
