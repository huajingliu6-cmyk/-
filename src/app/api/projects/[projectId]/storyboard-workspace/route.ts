import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  buildAssetsSummary,
  loadAuthorizedWorkspace,
  parseJsonBody,
} from "@/projects/storyboard/api-helpers";
import { saveWorkspace } from "@/projects/storyboard/production-store";
import { parseStoryboardVideoDefaults } from "@/projects/storyboard/storyboard-video-params";

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
  const hasActiveEpisodeId = typeof raw.activeEpisodeId === "string";
  const hasVideoDefaults = "videoDefaults" in raw;

  if (!hasActiveEpisodeId && !hasVideoDefaults) {
    return NextResponse.json(
      { error: "请提供 activeEpisodeId 或 videoDefaults" },
      { status: 400 },
    );
  }

  const { workspace, episodes } = loaded.context;
  let nextActiveEpisodeId = workspace.activeEpisodeId;
  let nextVideoDefaults = workspace.videoDefaults;

  if (hasActiveEpisodeId) {
    const activeEpisodeId = raw.activeEpisodeId as string;
    const hasEpisode = episodes.some((episode) => episode.id === activeEpisodeId);
    const hasProduction = workspace.productions.some(
      (production) => production.episodeId === activeEpisodeId,
    );
    if (!hasEpisode || !hasProduction) {
      return NextResponse.json({ error: "分集不存在" }, { status: 404 });
    }
    nextActiveEpisodeId = activeEpisodeId;
  }

  if (hasVideoDefaults) {
    if (raw.videoDefaults === null) {
      nextVideoDefaults = null;
    } else {
      const parsed = parseStoryboardVideoDefaults(raw.videoDefaults);
      if (!parsed) {
        return NextResponse.json(
          { error: "videoDefaults 无效" },
          { status: 400 },
        );
      }
      nextVideoDefaults = parsed;
    }
  }

  const saved = await saveWorkspace({
    ...workspace,
    activeEpisodeId: nextActiveEpisodeId,
    videoDefaults: nextVideoDefaults,
  });

  return NextResponse.json({ workspace: saved });
}
