import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  findProduction,
  loadAuthorizedWorkspace,
  persistProduction,
} from "@/projects/storyboard/api-helpers";
import {
  getShotVideoPrompt,
  isShotConfirmReady,
  listFlatShots,
} from "@/projects/storyboard/shot-completeness";

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

  if (
    production.status !== "storyboard_review" &&
    production.status !== "storyboard_incomplete"
  ) {
    return NextResponse.json(
      { error: "分镜尚未准备好确认" },
      { status: 400 },
    );
  }

  const storyboard = production.activeStoryboard;
  if (!storyboard) {
    return NextResponse.json({ error: "分镜尚未生成" }, { status: 400 });
  }

  const flat = listFlatShots(storyboard.scenes);
  const incomplete = flat.filter((row) => !isShotConfirmReady(row.shot));
  if (incomplete.length > 0) {
    const first = incomplete[0]!;
    return NextResponse.json(
      {
        error: `当前还有 ${incomplete.length} 个镜头需要补充提示词或素材。`,
        incompleteCount: incomplete.length,
        firstIncompleteShotId: first.shot.id,
      },
      { status: 400 },
    );
  }

  for (const row of flat) {
    if (!getShotVideoPrompt(row.shot)) {
      return NextResponse.json(
        { error: `镜头 ${row.shot.shotNumber} 缺少视频提示词` },
        { status: 400 },
      );
    }
    if (row.shot.durationSeconds <= 0) {
      return NextResponse.json(
        { error: `镜头 ${row.shot.shotNumber} 时长无效` },
        { status: 400 },
      );
    }
  }

  const now = new Date().toISOString();
  const nextStoryboard = {
    ...storyboard,
    status: "confirmed" as const,
    confirmedAt: now,
    confirmedBy: session.user.id,
    revision: storyboard.revision + 1,
    updatedAt: now,
    scenes: storyboard.scenes.map((scene) => ({
      ...scene,
      confirmed: true,
      shots: scene.shots.map((shot) => ({
        ...shot,
        confirmed: true,
      })),
    })),
  };

  const updated = await persistProduction(loaded.context.workspace, {
    ...production,
    activeStoryboard: nextStoryboard,
    status: "storyboard_done",
    currentStep: 2,
    storyboardStale: false,
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ production: updated });
}
