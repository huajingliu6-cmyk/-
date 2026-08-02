import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  findProduction,
  isRecord,
  loadAuthorizedWorkspace,
  parseJsonBody,
  persistProduction,
} from "@/projects/storyboard/api-helpers";
import { invalidateAfterScriptChange } from "@/projects/storyboard/services/invalidate";

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

  return NextResponse.json({ production });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId, episodeId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const production = findProduction(loaded.context.workspace, episodeId);
  if (!production) {
    return NextResponse.json({ error: "分集制作不存在" }, { status: 404 });
  }

  const body = await parseJsonBody(request);
  if (body === null || !isRecord(body)) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  if (typeof body.workingScriptText !== "string") {
    return NextResponse.json({ error: "workingScriptText 无效" }, { status: 400 });
  }

  const acknowledgeInvalidate = body.acknowledgeInvalidate === true;
  const willInvalidateDownstream =
    production.confirmedScriptText !== null &&
    body.workingScriptText !== production.confirmedScriptText &&
    (production.assetMatches.length > 0 ||
      production.assetsConfirmedAt !== null ||
      production.activeStoryboard !== null ||
      production.currentStep > 1);

  if (willInvalidateDownstream && !acknowledgeInvalidate) {
    return NextResponse.json(
      {
        error:
          "修改本集剧本后，现有分镜提示词可能不再完全适用。保存后仍可继续使用，也可整集或按镜头重新生成。",
        code: "SCRIPT_CHANGE_INVALIDATES_DOWNSTREAM",
        requiresAcknowledge: true,
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  let next = {
    ...production,
    workingScriptText: body.workingScriptText,
    workingScriptRevision: production.workingScriptRevision + 1,
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  };

  if (willInvalidateDownstream) {
    next = invalidateAfterScriptChange(next);
  }

  const updated = await persistProduction(loaded.context.workspace, next);
  return NextResponse.json({ production: updated });
}
