import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { listApprovalCandidates } from "@/projects/assets/approvals/candidates";
import { loadAssetApprovalsFile } from "@/projects/assets/approvals/store";
import { submitAssetApproval } from "@/projects/assets/approvals/submit";
import { getProjectRecord } from "@/projects/project-access";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import { guardAssetApprovalRemoteData } from "@/projects/assets/approvals/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardAssetApprovalRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  const project = guardedProject;
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const url = new URL(request.url);
  const episodeId = url.searchParams.get("episodeId")?.trim() ?? "";
  if (!episodeId) {
    return NextResponse.json(
      { error: "缺少 episodeId", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const guardedCandidates = await guardAssetApprovalRemoteData(async () => {
    await ensureWorkspaceInitialized(projectId);
    return listApprovalCandidates({ projectId, episodeId });
  });
  if (guardedCandidates instanceof NextResponse) return guardedCandidates;
  const listed = guardedCandidates;
  if (!listed.ok) {
    return NextResponse.json(
      { error: listed.message, code: listed.code },
      { status: 404 },
    );
  }

  const guardedFile = await guardAssetApprovalRemoteData(() =>
    loadAssetApprovalsFile(projectId),
  );
  if (guardedFile instanceof NextResponse) return guardedFile;
  const file = guardedFile;
  const submissions = file.submissions.filter(
    (s) => s.episodeId === episodeId,
  );

  return NextResponse.json({
    projectId,
    episodeId,
    projectName: project.name,
    candidates: listed.candidates,
    submissions,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;


  const guardedProject = await guardAssetApprovalRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  const project = guardedProject;
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

  const episodeId =
    typeof raw.episodeId === "string" ? raw.episodeId.trim() : "";
  const generatedMediaIds = Array.isArray(raw.generatedMediaIds)
    ? raw.generatedMediaIds
    : Array.isArray(raw.itemIds)
      ? raw.itemIds
      : null;
  if (!episodeId || !generatedMediaIds) {
    return NextResponse.json(
      {
        error: "缺少 episodeId 或 generatedMediaIds",
        code: "INVALID_REQUEST",
      },
      { status: 400 },
    );
  }

  const idempotencyKey =
    request.headers.get("Idempotency-Key")?.trim() ||
    (typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : null);

  const guardedResult = await guardAssetApprovalRemoteData(async () => {
    await ensureWorkspaceInitialized(projectId);
    return submitAssetApproval({
      projectId,
      episodeId,
      generatedMediaIds: generatedMediaIds.filter(
        (id): id is string => typeof id === "string",
      ),
      submittedByUserId: gated.user.id,
      idempotencyKey,
    });
  });
  if (guardedResult instanceof NextResponse) return guardedResult;
  const result = guardedResult;

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status ?? 400 },
    );
  }

  return NextResponse.json({
    submission: result.submission,
    counts: result.counts,
    reused: result.reused,
  });
}
