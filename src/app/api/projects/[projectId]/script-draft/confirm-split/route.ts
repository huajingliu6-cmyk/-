import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import {
  loadScriptDraft,
  saveScriptDraft,
} from "@/projects/script/script-draft-store";
import { confirmScriptSplit } from "@/projects/script/script-split-confirm";
import { attachScriptDownstreamSync } from "@/projects/script/script-auto-split";
import { afterScriptSplitConfirmed } from "@/projects/assets/extraction/after-confirm";
import type { ProposedEpisode } from "@/projects/script/script-split-types";
import { guardScriptDraftRemoteData } from "@/projects/script/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

function parseProposedEpisodes(raw: unknown): ProposedEpisode[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ProposedEpisode[] = [];
  for (const item of raw) {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item)
    ) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    if (
      typeof rec.id !== "string" ||
      typeof rec.episodeNumber !== "number" ||
      typeof rec.title !== "string" ||
      typeof rec.text !== "string" ||
      typeof rec.contentFingerprint !== "string"
    ) {
      continue;
    }
    out.push({
      id: rec.id,
      episodeNumber: rec.episodeNumber,
      title: rec.title,
      text: rec.text,
      contentFingerprint: rec.contentFingerprint,
    });
  }
  return out.length > 0 ? out : undefined;
}

async function confirmSplit(request: Request, context: RouteContext) {
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

  const sourceFingerprint =
    typeof raw.sourceFingerprint === "string"
      ? raw.sourceFingerprint.trim()
      : "";
  const confirmedRevision =
    typeof raw.confirmedRevision === "number"
      ? raw.confirmedRevision
      : null;
  const idempotencyKey =
    typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : "";

  if (!sourceFingerprint) {
    return NextResponse.json(
      { error: "缺少 sourceFingerprint", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }
  if (confirmedRevision === null || !Number.isInteger(confirmedRevision)) {
    return NextResponse.json(
      { error: "缺少 confirmedRevision", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "缺少 idempotencyKey", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const draft = await loadScriptDraft(projectId);
  if (!draft) {
    return NextResponse.json({ error: "剧本草稿不存在" }, { status: 404 });
  }

  const result = confirmScriptSplit({
    draft,
    sourceFingerprint,
    confirmedRevision,
    proposedEpisodes: parseProposedEpisodes(raw.proposedEpisodes),
    idempotencyKey,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  if (result.idempotent) {
    const extraction = await afterScriptSplitConfirmed({
      projectId,
      sourceFingerprint,
    });
    return NextResponse.json({
      draft: result.draft,
      idempotent: true,
      extractionAction: extraction.action,
      downstreamSync: await attachScriptDownstreamSync(projectId),
    });
  }

  const saved = await saveScriptDraft(result.draft);
  const extraction = await afterScriptSplitConfirmed({
    projectId,
    sourceFingerprint,
  });

  return NextResponse.json({
    draft: saved,
    idempotent: false,
    extractionAction: extraction.action,
    downstreamSync: await attachScriptDownstreamSync(projectId),
  });
}

export function POST(
  request: Request,
  context: RouteContext,
) {
  return guardScriptDraftRemoteData(() => confirmSplit(request, context));
};
