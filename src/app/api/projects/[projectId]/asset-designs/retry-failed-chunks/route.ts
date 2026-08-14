import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { retryFailedScriptAssetChunks } from "@/projects/assets/episode-design/retry-failed-chunks";
import { guardEpisodeAssetDesignRemoteData } from "@/projects/assets/episode-design/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardEpisodeAssetDesignRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  if (!guardedProject) {
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
  const generationId =
    typeof raw?.generationId === "string" ? raw.generationId.trim() : "";
  if (!generationId) {
    return NextResponse.json(
      { error: "缺少 generationId", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const result = await retryFailedScriptAssetChunks({
    projectId,
    generationId,
    userId: gated.user.id,
  });
  if (!result.ok) {
    const status =
      result.code === "FORBIDDEN"
        ? 403
        : result.code === "GENERATION_NOT_FOUND" || result.code === "NOT_FOUND"
          ? 404
          : 400;
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status },
    );
  }

  return NextResponse.json({
    generationId: result.generationId,
    content: result.content,
    failedRemaining: result.failedRemaining,
  });
}
