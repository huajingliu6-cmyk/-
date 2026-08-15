import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { confirmWorkspaceEpisodeAssetDesign } from "@/projects/workspace-sync/workspace-confirm";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId, episodeId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  if (project.approvalEnabled) {
    return NextResponse.json(
      {
        error: "项目已开启审批，请提交审批后由项目主理人处理。",
        code: "WORKSPACE_CONFIRM_REQUIRES_APPROVAL",
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const raw =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const expectedRevision =
    typeof raw?.expectedRevision === "number" ? raw.expectedRevision : null;
  const fingerprint =
    typeof raw?.fingerprint === "string" ? raw.fingerprint.trim() : "";
  if (expectedRevision === null || !Number.isInteger(expectedRevision) || !fingerprint) {
    return NextResponse.json(
      { error: "缺少有效的版本或剧本指纹", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const result = await confirmWorkspaceEpisodeAssetDesign({
    projectId,
    episodeId,
    expectedRevision,
    fingerprint,
    userId: gated.user.id,
  });
  if (!result.ok) {
    const status =
      result.code === "EPISODE_DESIGN_NOT_FOUND"
        ? 404
        : result.code === "REVISION_CONFLICT" ||
            result.code === "FINGERPRINT_STALE"
          ? 409
          : 400;
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status },
    );
  }
  return NextResponse.json(result);
}
