import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectPublic } from "@/projects/project-access";
import { buildProjectWorkbenchSummary } from "@/projects/workbench/summarize";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** GET：项目管理侧工作台只读聚合摘要（抽卡工程师禁止） */
export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectPublic(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const summary = await buildProjectWorkbenchSummary(project);
  return NextResponse.json({ workbench: summary });
}
