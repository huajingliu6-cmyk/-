import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import { applyWorkspaceEpisodeAssetDesignGeneration } from "@/projects/workspace-sync/workspace-episode-design-api";
import { guardWorkspaceRemoteData } from "@/projects/workspace-sync/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId, episodeId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardWorkspaceRemoteData(() =>
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

  const generationId =
    typeof raw.generationId === "string" ? raw.generationId.trim() : "";
  const rawText = typeof raw.rawText === "string" ? raw.rawText : "";
  const fingerprint =
    typeof raw.fingerprint === "string" ? raw.fingerprint.trim() : "";
  const expectedRevision =
    typeof raw.expectedRevision === "number" ? raw.expectedRevision : undefined;

  if (!generationId) {
    return NextResponse.json(
      { error: "缺少 generationId", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }
  if (!fingerprint) {
    return NextResponse.json(
      { error: "缺少 fingerprint", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const guardedResult = await guardWorkspaceRemoteData(async () => {
    await ensureWorkspaceInitialized(projectId);
    return applyWorkspaceEpisodeAssetDesignGeneration({
      projectId,
      episodeId,
      generationId,
      rawText,
      expectedRevision,
      fingerprint,
    });
  });
  if (guardedResult instanceof NextResponse) return guardedResult;
  const result = guardedResult;

  if (!result.ok) {
    const status =
      result.code === "REVISION_CONFLICT" || result.code === "FINGERPRINT_STALE"
        ? 409
        : result.code === "EPISODE_NOT_FOUND" ||
            result.code === "GENERATION_NOT_FOUND"
          ? 404
          : 400;
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        warnings: result.warnings ?? [],
        rejectedItems: result.rejectedItems ?? [],
      },
      { status },
    );
  }

  return NextResponse.json({
    record: result.record,
    warnings: result.warnings,
    rejectedItems: result.rejectedItems,
    repaired: result.repaired,
  });
}
