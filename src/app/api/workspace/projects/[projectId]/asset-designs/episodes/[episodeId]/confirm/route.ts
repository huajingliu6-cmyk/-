import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

/**
 * Workspace confirm into formal library is blocked.
 * Formal入库 only via owner approval of submitted generated media.
 */
export async function POST(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json(
    {
      error:
        "工作台不可直接确认入库。请使用「提交审批素材」，由项目主理人审批后入库。",
      code: "WORKSPACE_CONFIRM_REQUIRES_APPROVAL",
    },
    { status: 403 },
  );
}
