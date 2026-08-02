import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  findProduction,
  loadAuthorizedWorkspace,
  persistProduction,
} from "@/projects/storyboard/api-helpers";
import { stableHash } from "@/projects/storyboard/hash";
import { invalidateOnScriptReconfirm } from "@/projects/storyboard/services/invalidate";

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

  if (!production.workingScriptText.trim()) {
    return NextResponse.json({ error: "剧本内容不能为空" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const hadDownstream =
    production.assetMatches.length > 0 ||
    production.assetsConfirmedAt !== null ||
    production.activeStoryboard !== null ||
    (production.confirmedScriptText !== null &&
      production.confirmedScriptText !== production.workingScriptText);

  const confirmedBase = {
    ...production,
    confirmedScriptText: production.workingScriptText,
    confirmedScriptRevision: production.workingScriptRevision,
    confirmedScriptHash: stableHash(production.workingScriptText),
    scriptConfirmedAt: now,
    scriptConfirmedBy: session.user.id,
    currentStep: 2 as const,
    status: "awaiting_storyboard" as const,
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
    assetsStale: false,
    storyboardStale: false,
  };

  const updated = await persistProduction(
    loaded.context.workspace,
    hadDownstream
      ? invalidateOnScriptReconfirm(confirmedBase)
      : confirmedBase,
  );

  return NextResponse.json({ production: updated });
}
