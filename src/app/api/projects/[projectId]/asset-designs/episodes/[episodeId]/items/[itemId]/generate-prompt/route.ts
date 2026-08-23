import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import {
  getEpisodeAssetDesignDetail,
  patchEpisodeItemDesignPrompt,
} from "@/projects/assets/episode-design/episode-design-api";
import { runGenerateDesignPromptPost } from "@/projects/assets/episode-design/run-generate-design-prompt-route";
import { guardEpisodeAssetDesignRemoteData } from "@/projects/assets/episode-design/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; itemId: string }>;
};

async function post(request: Request, context: RouteContext) {
  const { projectId, episodeId, itemId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  return runGenerateDesignPromptPost({
    request,
    projectId,
    episodeId,
    itemId,
    userId: gated.user.id,
    loadDetail: () => getEpisodeAssetDesignDetail(projectId, episodeId),
    patchItem: async ({ designPrompt, designConversation }) => {
      const detail = await getEpisodeAssetDesignDetail(projectId, episodeId);
      if (!detail.ok) return detail;
      return patchEpisodeItemDesignPrompt({
        projectId,
        episodeId,
        itemId,
        fingerprint: detail.currentFingerprint,
        designPrompt,
        designConversation,
      });
    },
  });
}

export function POST(request: Request, context: RouteContext) {
  return guardEpisodeAssetDesignRemoteData(() => post(request, context));
}
