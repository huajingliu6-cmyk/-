import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  buildAssetsSummary,
  loadAuthorizedWorkspace,
  parseJsonBody,
} from "@/projects/storyboard/api-helpers";
import { saveWorkspace } from "@/projects/storyboard/production-store";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const { project, episodes, workspace, assetsDraft } = loaded.context;
  if (episodes.length === 0) {
    return NextResponse.json({
      episodes: [],
      workspace: null,
      assets: null,
    });
  }

  return NextResponse.json({
    project,
    episodes,
    workspace,
    assetsSummary: buildAssetsSummary(assetsDraft),
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const activeEpisodeId =
    typeof raw.activeEpisodeId === "string" ? raw.activeEpisodeId : null;
  if (!activeEpisodeId) {
    return NextResponse.json({ error: "activeEpisodeId 无效" }, { status: 400 });
  }

  const { workspace, episodes } = loaded.context;
  const hasEpisode = episodes.some((episode) => episode.id === activeEpisodeId);
  const hasProduction = workspace.productions.some(
    (production) => production.episodeId === activeEpisodeId,
  );
  if (!hasEpisode || !hasProduction) {
    return NextResponse.json({ error: "分集不存在" }, { status: 404 });
  }

  const saved = await saveWorkspace({
    ...workspace,
    activeEpisodeId,
  });

  return NextResponse.json({ workspace: saved });
}
