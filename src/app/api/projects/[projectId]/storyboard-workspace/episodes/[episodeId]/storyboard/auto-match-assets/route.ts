import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  findProduction,
  loadAuthorizedWorkspace,
  persistProduction,
} from "@/projects/storyboard/api-helpers";
import { autoLinkStoryboardToLibrary } from "@/projects/storyboard/services/shot-library-match";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

/**
 * Re-match unresolved shot materials against the current project asset library.
 * Used when opening an existing storyboard after assets were confirmed later.
 */
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

  const storyboard = production.activeStoryboard;
  if (!storyboard) {
    return NextResponse.json({ production });
  }

  const libraryAssets = (await loadAssetBundleDraft(projectId)) ?? {
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  };
  const nextBoard = autoLinkStoryboardToLibrary(storyboard, libraryAssets);
  if (nextBoard === storyboard) {
    return NextResponse.json({ production, changed: false });
  }

  const now = new Date().toISOString();
  const updated = await persistProduction(loaded.context.workspace, {
    ...production,
    activeStoryboard: nextBoard,
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  });

  return NextResponse.json({
    production: updated,
    activeStoryboard: updated.activeStoryboard,
    changed: true,
  });
}
