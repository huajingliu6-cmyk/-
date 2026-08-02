import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import {
  getScriptSourceFingerprint,
  loadScriptDraft,
  saveScriptDraft,
} from "@/projects/script/script-draft-store";
import { buildLocalProposedEpisodes } from "@/projects/script/local-script-split";
import { emptyEpisodeSplitState } from "@/projects/script/script-split-types";
import { guardScriptDraftRemoteData } from "@/projects/script/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/**
 * 本地分集：按标题或段落块切出 proposedEpisodes（review），不调用大模型。
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

  const sourceFingerprint =
    typeof raw.sourceFingerprint === "string"
      ? raw.sourceFingerprint.trim()
      : "";

  const draft = await loadScriptDraft(projectId);
  if (!draft) {
    return NextResponse.json({ error: "剧本草稿不存在" }, { status: 404 });
  }

  const sourceText = draft.sourceText?.trim() ?? "";
  if (!sourceText) {
    return NextResponse.json(
      { error: "缺少剧本源文本", code: "SOURCE_TEXT_REQUIRED" },
      { status: 400 },
    );
  }

  const currentFp = getScriptSourceFingerprint(sourceText);
  if (sourceFingerprint && currentFp && sourceFingerprint !== currentFp) {
    const next = {
      ...draft,
      episodeSplit: {
        ...(draft.episodeSplit ?? emptyEpisodeSplitState()),
        status: "stale" as const,
        errorMessage: "源文本已变化，请重新分集",
      },
    };
    const saved = await saveScriptDraft(next);
    return NextResponse.json(
      {
        error: "源文本指纹不匹配",
        code: "SOURCE_FINGERPRINT_MISMATCH",
        draft: saved,
      },
      { status: 409 },
    );
  }

  const split = buildLocalProposedEpisodes(sourceText);
  if (split.proposedEpisodes.length === 0) {
    const next = {
      ...draft,
      episodeSplit: {
        ...(draft.episodeSplit ?? emptyEpisodeSplitState()),
        status: "failed" as const,
        generationId: null,
        sourceFingerprint: currentFp,
        errorMessage: "本地分集未得到有效剧集",
        proposedEpisodes: [],
      },
    };
    const saved = await saveScriptDraft(next);
    return NextResponse.json(
      {
        error: "本地分集未得到有效剧集",
        code: "LOCAL_SPLIT_EMPTY",
        draft: saved,
        warnings: split.warnings,
      },
      { status: 400 },
    );
  }

  const prev = draft.episodeSplit ?? emptyEpisodeSplitState();
  const next = {
    ...draft,
    episodeSplit: {
      ...prev,
      status: "review" as const,
      sourceFingerprint: currentFp,
      generationId: null,
      proposedEpisodes: split.proposedEpisodes,
      generatedAt: new Date().toISOString(),
      errorMessage: null,
    },
  };
  const saved = await saveScriptDraft(next);
  return NextResponse.json({
    draft: saved,
    mode: split.mode,
    warnings: split.warnings,
  });
}

export function POST(request: Request, context: RouteContext) {
  return guardScriptDraftRemoteData(() => localSplit(request, context));
}
