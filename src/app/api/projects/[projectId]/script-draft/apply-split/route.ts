import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import {
  getScriptSourceFingerprint,
  loadScriptDraft,
  saveScriptDraft,
} from "@/projects/script/script-draft-store";
import { splitSourceTextIntoBlocks } from "@/projects/script/script-split-blocks";
import { reconstructEpisodesFromBoundaries } from "@/projects/script/script-split-reconstruct";
import { parseScriptSplitModelOutput } from "@/projects/script/script-split-schema";
import { emptyEpisodeSplitState } from "@/projects/script/script-split-types";
import { guardScriptDraftRemoteData } from "@/projects/script/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/**
 * Apply LLM boundary JSON → proposedEpisodes (review). Does NOT write formal episodes.
 */
async function applySplit(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
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

  const rawText = typeof raw.rawText === "string" ? raw.rawText : "";
  const generationId =
    typeof raw.generationId === "string" ? raw.generationId : null;
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

  const blocks = splitSourceTextIntoBlocks(sourceText);
  const parsed = parseScriptSplitModelOutput(rawText);
  if (!parsed.ok) {
    const next = {
      ...draft,
      episodeSplit: {
        ...(draft.episodeSplit ?? emptyEpisodeSplitState()),
        status: "failed" as const,
        generationId,
        sourceFingerprint: currentFp,
        errorMessage: parsed.message,
        proposedEpisodes: [],
      },
    };
    const saved = await saveScriptDraft(next);
    return NextResponse.json(
      { error: parsed.message, code: parsed.code, draft: saved },
      { status: 400 },
    );
  }

  const rebuilt = reconstructEpisodesFromBoundaries(blocks, parsed.value);
  if (!rebuilt.ok) {
    const next = {
      ...draft,
      episodeSplit: {
        ...(draft.episodeSplit ?? emptyEpisodeSplitState()),
        status: "failed" as const,
        generationId,
        sourceFingerprint: currentFp,
        errorMessage: rebuilt.message,
        proposedEpisodes: [],
      },
    };
    const saved = await saveScriptDraft(next);
    return NextResponse.json(
      { error: rebuilt.message, code: rebuilt.code, draft: saved },
      { status: 400 },
    );
  }

  const prev = draft.episodeSplit ?? emptyEpisodeSplitState();
  const next = {
    ...draft,
    // Keep formal episodes unchanged until confirm-split.
    episodeSplit: {
      ...prev,
      status: "review" as const,
      sourceFingerprint: currentFp,
      generationId,
      proposedEpisodes: rebuilt.episodes,
      generatedAt: new Date().toISOString(),
      errorMessage: null,
    },
  };
  const saved = await saveScriptDraft(next);
  return NextResponse.json({ draft: saved });
}

export function POST(request: Request, context: RouteContext) {
  return guardScriptDraftRemoteData(() => applySplit(request, context));
}
