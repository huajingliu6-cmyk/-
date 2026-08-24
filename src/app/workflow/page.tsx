import { requireVideoCanvasAccess } from "@/auth/require-access";
import { WorkflowCanvasClient } from "./WorkflowCanvasClient";
import { WorkflowForbiddenPanel } from "./WorkflowForbiddenPanel";
import { WorkflowMissingProject } from "./WorkflowMissingProject";

type PageProps = {
  searchParams: Promise<{ projectId?: string | string[] }>;
};

/**
 * 视频制作画布：服务端在渲染 WorkflowEditor 前完成身份与项目权限校验。
 */
export default async function WorkflowPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = params.projectId;
  const projectId = Array.isArray(raw) ? raw[0]?.trim() ?? "" : raw?.trim() ?? "";

  if (!projectId) {
    return <WorkflowMissingProject />;
  }

  const gated = await requireVideoCanvasAccess(projectId);
  if (!gated.ok) {
    const status = gated.response.status;
    if (status === 401) {
      return (
        <WorkflowForbiddenPanel message="未登录，无权访问视频制作画布。请先登录后再试。" />
      );
    }
    if (status === 404) {
      return <WorkflowForbiddenPanel message="项目不存在或已被移除，请选择其他项目。" />;
    }
    return (
      <WorkflowForbiddenPanel message="你无权访问该项目的视频制作画布，请选择其他项目。" />
    );
  }

  return <WorkflowCanvasClient projectId={projectId} />;
}
