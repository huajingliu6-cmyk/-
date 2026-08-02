import { requireVideoCanvasAccess } from "@/auth/require-access";
import { WorkflowCanvasClient } from "./WorkflowCanvasClient";

type PageProps = {
  searchParams: Promise<{ projectId?: string | string[] }>;
};

function Forbidden({ message }: { message: string }) {
  return (
    <div
      className="flex h-svh items-center justify-center bg-[#070811] text-sm text-rose-200"
      data-testid="workflow-forbidden"
    >
      {message}
    </div>
  );
}

/**
 * 视频制作画布：服务端在渲染 WorkflowEditor 前完成身份与项目权限校验。
 * 抽卡工程师 / 无 projectId / DEMO 回退均不可进入。
 */
export default async function WorkflowPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = params.projectId;
  const projectId = Array.isArray(raw) ? raw[0]?.trim() ?? "" : raw?.trim() ?? "";

  if (!projectId) {
    return (
      <Forbidden message="缺少 projectId，无权访问视频制作画布" />
    );
  }

  const gated = await requireVideoCanvasAccess(projectId);
  if (!gated.ok) {
    const status = gated.response.status;
    if (status === 401) {
      return <Forbidden message="未登录，无权访问视频制作画布" />;
    }
    if (status === 404) {
      return <Forbidden message="项目不存在" />;
    }
    return <Forbidden message="无权访问视频制作画布" />;
  }

  return <WorkflowCanvasClient projectId={projectId} />;
}
