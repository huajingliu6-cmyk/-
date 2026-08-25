import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { loadAuthorizedWorkspace } from "@/projects/storyboard/api-helpers";
import { readStoryboardGenerationJob } from "@/projects/storyboard/services/storyboard-generation-job";

type RouteContext = {
  params: Promise<{
    projectId: string;
    episodeId: string;
    generationId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId, episodeId, generationId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const production =
    loaded.context.workspace.productions.find((p) => p.episodeId === episodeId) ??
    null;
  if (!production) {
    return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
  }

  const job = readStoryboardGenerationJob(production, generationId);
  if (!job) {
    return NextResponse.json({ error: "生成任务不存在" }, { status: 404 });
  }

  return NextResponse.json({
    generationId: job.generationId,
    status: job.status,
    error: job.error,
    promptsNotWritten: job.promptsNotWritten === true,
    production,
    activeStoryboard: production.activeStoryboard,
  });
}
