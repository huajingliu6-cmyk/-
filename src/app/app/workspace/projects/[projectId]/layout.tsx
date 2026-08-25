import { assertWorkspaceProjectPage } from "@/auth/page-guards";
import { getProjectRecord } from "@/projects/project-access";
import { ProjectStageNav } from "@/projects/workbench/ProjectStageNav";
import { WorkspaceSyncStatusBanner } from "@/projects/workspace-sync/WorkspaceSyncStatusBanner";
import { ScriptDownstreamPipelineGuard } from "@/projects/script/ScriptDownstreamPipelineGuard";
import { APP_WORKBENCH_PATH } from "@/shell/nav";
import "@/projects/workbench/workbench.css";

/** 工作台项目页及子路由门禁 */
export default async function WorkspaceProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<unknown>;
}) {
  const resolved = (await params) as { projectId?: string };
  const projectId = resolved.projectId ?? "";
  await assertWorkspaceProjectPage(projectId);
  const project = await getProjectRecord(projectId);
  return (
    <div className="project-route-shell">
      <ProjectStageNav
        projectId={projectId}
        mode="workspace"
        brandLabel={project?.name ?? "未命名项目"}
        backHref={APP_WORKBENCH_PATH}
      />
      <WorkspaceSyncStatusBanner projectId={projectId} />
      <ScriptDownstreamPipelineGuard projectId={projectId} mode="workspace" />
      {children}
    </div>
  );
}
