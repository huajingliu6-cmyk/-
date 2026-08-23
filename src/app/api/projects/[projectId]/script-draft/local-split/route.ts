import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import { commitImportedScriptAutoSplit } from "@/projects/script/script-auto-split";
import { guardScriptDraftRemoteData } from "@/projects/script/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/**
 * Local split + confirm: parse by existing title/block rules and create formal episodes.
 * Idempotent for the same source fingerprint. Never overwrites existing episodes.
 */
async function localSplit(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  let body: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!raw) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const draft = await loadScriptDraft(projectId);
  if (!draft) {
    return NextResponse.json({ error: "剧本草稿不存在" }, { status: 404 });
  }

  const result = await commitImportedScriptAutoSplit({
    previous: draft,
    nextDraft: draft,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        draft: result.draft,
        warnings: result.warnings,
        downstreamSync: result.downstreamSync,
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    draft: result.draft,
    confirmed: true,
    idempotent: result.idempotent,
    mode: result.mode,
    warnings: result.warnings,
    downstreamSync: result.downstreamSync,
    extractionAction: result.extractionAction,
  });
}

export function POST(
  request: Request,
  context: RouteContext,
) {
  return guardScriptDraftRemoteData(() => localSplit(request, context));
};
