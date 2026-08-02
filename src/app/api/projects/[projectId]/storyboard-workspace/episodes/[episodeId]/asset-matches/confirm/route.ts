import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  findProduction,
  isMatchProcessed,
  loadAuthorizedWorkspace,
  persistProduction,
} from "@/projects/storyboard/api-helpers";
import { stableHash } from "@/projects/storyboard/hash";
import { invalidateOnAssetsReconfirm } from "@/projects/storyboard/services/invalidate";

/**
 * @deprecated deprecated for legacy compatibility；新分镜主流程不调用。
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

  if (production.assetMatches.length === 0) {
    return NextResponse.json({ error: "请先完成资产匹配" }, { status: 400 });
  }

  const unprocessed = production.assetMatches.filter((item) => !isMatchProcessed(item));
  if (unprocessed.length > 0) {
    return NextResponse.json(
      { error: "仍有未处理的资产匹配项" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const snapshotHash = stableHash(JSON.stringify(production.assetMatches));
  const base = {
    ...production,
    confirmedAssetSnapshotHash: snapshotHash,
    assetsConfirmedAt: now,
    assetsConfirmedBy: session.user.id,
    assetsStale: false,
    currentStep: 2 as const,
    status: "awaiting_storyboard" as const,
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  };
  const next =
    production.activeStoryboard !== null
      ? {
          ...invalidateOnAssetsReconfirm(base),
          confirmedAssetSnapshotHash: snapshotHash,
          assetsConfirmedAt: now,
          assetsConfirmedBy: session.user.id,
          assetsStale: false,
          currentStep: 2 as const,
          status: "awaiting_storyboard" as const,
          revision: production.revision + 1,
          lastEditedAt: now,
          updatedAt: now,
        }
      : base;

  const updated = await persistProduction(loaded.context.workspace, next);
  return NextResponse.json({ production: updated });
}
