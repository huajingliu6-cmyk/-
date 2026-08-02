import { NextResponse } from "next/server";
import { requireWorkspaceProjectAccess } from "@/auth/require-access";
import { getProjectPublic } from "@/projects/project-access";
import { workspaceFeaturesForRole } from "@/auth/roles";
import {
  workflowEditorPath,
  workspaceProjectAssetsPath,
  workspaceProjectStoryboardPath,
} from "@/shell/nav";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** GET：工作台项目摘要（不含剧本创作） */
export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectPublic(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const features = workspaceFeaturesForRole(gated.access.role);
  const stages = [];

  if (features.includes("assets")) {
    stages.push({
      id: "assets" as const,
      title: "项目资产",
      description: "管理角色、场景、道具与音频资产。",
      href: workspaceProjectAssetsPath(projectId),
      enabled: true,
      actionLabel: "进入项目资产",
    });
  }
  if (features.includes("storyboard")) {
    stages.push({
      id: "storyboard" as const,
      title: "分镜创作",
      description: "确认剧本、匹配资产并生成文字分镜。",
      href: workspaceProjectStoryboardPath(projectId),
      enabled: true,
      actionLabel: "进入分镜创作",
    });
  }
  if (features.includes("video") && project.projectMode === "canvas") {
    stages.push({
      id: "video" as const,
      title: "视频制作",
      description: "在节点画布中编排镜头并生成视频。",
      href: workflowEditorPath(projectId),
      enabled: true,
      actionLabel: "进入视频制作画布",
    });
  }

  return NextResponse.json({
    project: {
      projectId: project.projectId,
      name: project.name,
      status: project.status,
      creationSource: project.creationSource,
      projectMode: project.projectMode,
      updatedAt: project.updatedAt,
    },
    effectiveRole: gated.access.role,
    workspaceFeatures: features,
    stages,
  });
}
