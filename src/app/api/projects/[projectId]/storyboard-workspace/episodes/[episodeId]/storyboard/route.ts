import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  findProduction,
  loadAuthorizedWorkspace,
} from "@/projects/storyboard/api-helpers";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId, episodeId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const production = findProduction(loaded.context.workspace, episodeId);
  if (!production) {
    return NextResponse.json({ error: "分集制作不存在" }, { status: 404 });
  }

  return NextResponse.json({ activeStoryboard: production.activeStoryboard });
}
