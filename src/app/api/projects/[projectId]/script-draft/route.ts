import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { applyGeneratedEpisodesToDraft } from "@/projects/script/apply-generated-episodes";
import { scriptDraftContentChanged } from "@/projects/script/script-content-fingerprint";
import {
  loadScriptDraft,
  normalizeScriptDraft,
  saveScriptDraft,
} from "@/projects/script/script-draft-store";
import {
  parseScriptEpisodesGenerationOutput,
  ScriptEpisodesGenerationDtoSchema,
} from "@/projects/script/script-episodes-generation-schema";
import { guardScriptDraftRemoteData } from "@/projects/script/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

async function getScriptDraft(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const draft = await loadScriptDraft(projectId);
  return NextResponse.json({
    project: {
      projectId: project.projectId,
      rootFolderId: project.rootFolderId,
      name: project.name,
      status: project.status,
      projectMode: project.projectMode,
    },
    draft,
  });
}

async function putScriptDraft(request: Request, context: RouteContext) {
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

  const bodyRecord =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;

  const previous = await loadScriptDraft(projectId);

  if (bodyRecord?.clearScript === true) {
    const { emptyEpisodeSplitState } = await import(
      "@/projects/script/script-split-types"
    );
    const base =
      previous ??
      normalizeScriptDraft(projectId, { projectId, ...bodyRecord });
    if (!base) {
      return NextResponse.json({ error: "剧本草稿格式无效" }, { status: 400 });
    }
    const cleared = {
      ...base,
      sourceFile: null,
      sourceText: null,
      sourceImport: null,
      preambleNotes: null,
      episodes: [],
      selectedId: null,
      episodeSplit: emptyEpisodeSplitState(),
    };
    const draft = await saveScriptDraft(cleared);
    return NextResponse.json({
      draft,
      invalidated: scriptDraftContentChanged(previous, draft),
    });
  }

  // Apply structured episode generation (single-episode merge).
  if (bodyRecord && Object.hasOwn(bodyRecord, "applyGeneratedEpisodes")) {
    if (!previous) {
      return NextResponse.json({ error: "剧本草稿不存在" }, { status: 404 });
    }
    const parsedDto = ScriptEpisodesGenerationDtoSchema.safeParse(
      bodyRecord.applyGeneratedEpisodes,
    );
    if (!parsedDto.success) {
      return NextResponse.json(
        {
          error: "结构化剧集无效",
          code: "SCRIPT_EPISODES_OUTPUT_INVALID",
        },
        { status: 400 },
      );
    }
    // Server re-parse via shared parser (count / number checks).
    const reparsed = parseScriptEpisodesGenerationOutput(
      JSON.stringify(parsedDto.data),
      {
        expectedCount: 1,
        expectedEpisodeNumber: parsedDto.data.episodes[0]?.number,
      },
    );
    if (!reparsed.ok) {
      return NextResponse.json(
        { error: reparsed.message, code: reparsed.code },
        { status: 400 },
      );
    }

    const applied = applyGeneratedEpisodesToDraft({
      previous,
      dto: reparsed.value,
      expectedUpdatedAt:
        typeof bodyRecord.expectedUpdatedAt === "string"
          ? bodyRecord.expectedUpdatedAt
          : undefined,
      expectedOutlineFingerprint:
        typeof bodyRecord.expectedOutlineFingerprint === "string"
          ? bodyRecord.expectedOutlineFingerprint
          : undefined,
    });
    if (!applied.ok) {
      return NextResponse.json(
        { error: applied.message, code: applied.code },
        { status: applied.status },
      );
    }

    const contentChanged = scriptDraftContentChanged(
      previous,
      applied.draft,
    );
    const draft = await saveScriptDraft(applied.draft);
    return NextResponse.json({
      draft,
      invalidated: contentChanged,
    });
  }

  if (bodyRecord && bodyRecord.autoSplit === true) {
    const { commitImportedScriptAutoSplit } = await import(
      "@/projects/script/script-auto-split"
    );
    const { emptyEpisodeSplitState } = await import(
      "@/projects/script/script-split-types"
    );
    const replaceExisting = bodyRecord.replaceExisting === true;
    const incoming = normalizeScriptDraft(projectId, {
      ...bodyRecord,
      episodes: replaceExisting ? [] : (previous?.episodes ?? []),
      selectedId: replaceExisting ? null : (previous?.selectedId ?? null),
      episodeSplit: replaceExisting
        ? emptyEpisodeSplitState()
        : (previous?.episodeSplit ?? emptyEpisodeSplitState()),
      outlineText:
        previous && !Object.hasOwn(bodyRecord, "outlineText") && !replaceExisting
          ? previous.outlineText
          : bodyRecord.outlineText,
      ...(replaceExisting && previous?.documentRevision != null
        ? { documentRevision: previous.documentRevision }
        : {}),
    });
    if (!incoming) {
      return NextResponse.json({ error: "剧本草稿格式无效" }, { status: 400 });
    }
    const result = await commitImportedScriptAutoSplit({
      previous: replaceExisting ? null : previous,
      nextDraft: {
        ...incoming,
        episodes: replaceExisting ? [] : (previous?.episodes ?? []),
        selectedId: replaceExisting
          ? null
          : (previous?.selectedId ?? incoming.selectedId),
        episodeSplit: replaceExisting
          ? emptyEpisodeSplitState()
          : (previous?.episodeSplit ?? emptyEpisodeSplitState()),
        outlineText: replaceExisting
          ? incoming.outlineText
          : (previous?.outlineText ?? incoming.outlineText),
      },
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
      autoSplit: true,
      confirmed: true,
      idempotent: result.idempotent,
      mode: result.mode,
      warnings: result.warnings,
      downstreamSync: result.downstreamSync,
      extractionAction: result.extractionAction,
      invalidated: scriptDraftContentChanged(previous, result.draft),
    });
  }

  const normalized = normalizeScriptDraft(projectId, body);
  if (!normalized) {
    return NextResponse.json({ error: "剧本草稿格式无效" }, { status: 400 });
  }

  // Optional optimistic concurrency for clients that send expectedUpdatedAt.
  if (
    previous &&
    bodyRecord &&
    typeof bodyRecord.expectedUpdatedAt === "string" &&
    bodyRecord.expectedUpdatedAt !== previous.updatedAt
  ) {
    return NextResponse.json(
      {
        error: "剧本草稿已更新，请重新加载后再保存。",
        code: "SCRIPT_DRAFT_CONFLICT",
      },
      { status: 409 },
    );
  }

  const contentChanged = scriptDraftContentChanged(previous, normalized);

  // Same content: preserve episode IDs / rows; only refresh import metadata clocks.
  let toSave = normalized;
  // Callers that omit outlineText (e.g. script import UI) must not wipe outline.
  if (previous && bodyRecord && !Object.hasOwn(bodyRecord, "outlineText")) {
    toSave = { ...toSave, outlineText: previous.outlineText };
  }
  if (
    previous &&
    !contentChanged &&
    previous.episodes.length === normalized.episodes.length
  ) {
    toSave = {
      ...toSave,
      episodes: previous.episodes,
      selectedId: previous.selectedId,
      sourceText: previous.sourceText,
      preambleNotes: previous.preambleNotes,
      sourceImport: normalized.sourceImport
        ? {
            ...normalized.sourceImport,
            // Keep sha/encoding from request but allow importedAt refresh.
          }
        : previous.sourceImport,
    };
  }
  if (
    previous &&
    previous.episodes.length > 0 &&
    toSave.episodes.length === 0
  ) {
    toSave = {
      ...toSave,
      episodes: previous.episodes,
      selectedId: previous.selectedId,
      episodeSplit: previous.episodeSplit ?? toSave.episodeSplit,
    };
  }

  const draft = await saveScriptDraft(toSave);

  return NextResponse.json({
    draft,
    invalidated: contentChanged,
  });
}

export function GET(request: Request, context: RouteContext) {
  return guardScriptDraftRemoteData(() => getScriptDraft(request, context));
}

export function PUT(
  request: Request,
  context: RouteContext,
) {
  return guardScriptDraftRemoteData(() => putScriptDraft(request, context));
};
