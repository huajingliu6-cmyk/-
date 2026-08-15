import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import {
  getEpisodeAssetDesignDetail,
  patchEpisodeItemDesignPrompt,
} from "@/projects/assets/episode-design/episode-design-api";
import { runGenerateDesignPromptBatchPost } from "@/projects/assets/episode-design/run-generate-design-prompt-batch-route";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";
import { guardEpisodeAssetDesignRemoteData } from "@/projects/assets/episode-design/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

async function post(request: Request, context: RouteContext) {
  const { projectId, episodeId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  return runGenerateDesignPromptBatchPost({
    request,
    projectId,
    episodeId,
    userId: gated.user.id,
    loadDetail: () => getEpisodeAssetDesignDetail(projectId, episodeId),
    patchItem: async ({ itemId, designPrompt }) => {
      const detail = await getEpisodeAssetDesignDetail(projectId, episodeId);
      if (!detail.ok) return detail;
      return patchEpisodeItemDesignPrompt({
        projectId,
        episodeId,
        itemId,
        fingerprint: detail.currentFingerprint,
        designPrompt,
      });
    },
    afterSuccess: async () => {
      await syncManagementToWorkspace(projectId);
    },
  });
}

export function POST(request: Request, context: RouteContext) {
  return guardEpisodeAssetDesignRemoteData(() => post(request, context));
}
