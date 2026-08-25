import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { loadAuthorizedWorkspace } from "@/projects/storyboard/api-helpers";
import { resolveEpisodeDownstreamStatusForProject } from "@/projects/storyboard/services/resolve-episode-downstream-status";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId, episodeId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const status = await resolveEpisodeDownstreamStatusForProject({
    projectId,
    episodeId,
    assetsDraft: loaded.context.assetsDraft,
  });

  return NextResponse.json({ status });
}
