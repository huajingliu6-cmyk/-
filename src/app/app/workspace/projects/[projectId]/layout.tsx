import { assertWorkspaceProjectPage } from "@/auth/page-guards";
import { ProjectStageNav } from "@/projects/workbench/ProjectStageNav";
import { WorkspaceSyncStatusBanner } from "@/projects/workspace-sync/WorkspaceSyncStatusBanner";
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
  return (
    <div className="project-route-shell">
      <ProjectStageNav projectId={projectId} mode="workspace" />
      <WorkspaceSyncStatusBanner projectId={projectId} />
      {children}
    </div>
  );
}
