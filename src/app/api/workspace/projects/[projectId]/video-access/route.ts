import { NextResponse } from "next/server";
import { requireVideoCanvasAccess } from "@/auth/require-access";
import { getProjectPublic } from "@/projects/project-access";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** GET：校验视频制作画布访问权（抽卡工程师 403） */
export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireVideoCanvasAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectPublic(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    projectId: project.projectId,
    projectName: project.name,
    effectiveRole: gated.access.role,
  });
}
