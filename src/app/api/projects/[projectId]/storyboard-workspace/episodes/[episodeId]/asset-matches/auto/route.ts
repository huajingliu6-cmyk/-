import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  findProduction,
  loadAuthorizedWorkspace,
  persistProduction,
} from "@/projects/storyboard/api-helpers";
import { runAutoMatch } from "@/projects/storyboard/services/asset-match";

/**
 * @deprecated deprecated for legacy compatibility；新分镜主流程不调用。
 * 保留供旧客户端/测试兼容，勿在 StoryboardCreationWorkspace 中挂载。
 */
type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId, episodeId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const production = findProduction(loaded.context.workspace, episodeId);
  if (!production) {
    return NextResponse.json({ error: "分集制作不存在" }, { status: 404 });
  }

  if (!production.confirmedScriptText?.trim()) {
    return NextResponse.json({ error: "请先确认剧本" }, { status: 400 });
  }

  const assets = loaded.context.assetsDraft;
  if (!assets) {
    return NextResponse.json({ error: "项目资产未就绪" }, { status: 400 });
  }

  const matches = runAutoMatch({
    scriptText: production.confirmedScriptText,
    assets: {
      characters: assets.characters,
      scenes: assets.scenes,
      props: assets.props,
      audios: assets.audios,
    },
    existingMatches: production.assetMatches,
  });

  const now = new Date().toISOString();
  const updated = await persistProduction(loaded.context.workspace, {
    ...production,
    assetMatches: matches,
    status: "assets_pending_confirm",
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ matches: updated.assetMatches, production: updated });
}
