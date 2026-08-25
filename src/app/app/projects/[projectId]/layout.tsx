import { assertProjectManagementProjectPage } from "@/auth/page-guards";
import { ProjectStageNav } from "@/projects/workbench/ProjectStageNav";
import { projectFlowConfigForMode } from "@/projects/project-flow";
import { WorkspaceSyncStatusBanner } from "@/projects/workspace-sync/WorkspaceSyncStatusBanner";
import { ScriptDownstreamPipelineGuard } from "@/projects/script/ScriptDownstreamPipelineGuard";
import { ProjectFlowHeaderSeed } from "@/shell/ProjectFlowHeaderShell";
import "@/projects/workbench/workbench.css";

/** 项目管理项目详情及子路由：仅系统管理员 / 项目主理人 */
export default async function ProjectManagementProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<unknown>;
}) {
  const resolved = (await params) as { projectId?: string };
  const projectId = resolved.projectId ?? "";
  const gated = await assertProjectManagementProjectPage(projectId);
  const scriptHref =
    gated.project.creationSource === "story"
      ? `/app/projects/${encodeURIComponent(projectId)}/story`
      : `/app/projects/${encodeURIComponent(projectId)}/script`;
  const flow = projectFlowConfigForMode(gated.project.projectMode);

  return (
    <div className="project-route-shell">
      <ProjectFlowHeaderSeed
        projectId={projectId}
        projectName={gated.project.name}
        scriptHref={scriptHref}
        mode="management"
      />
      <ProjectStageNav
        projectId={projectId}
        mode="management"
        scriptHref={scriptHref}
        brandLabel={gated.project.name}
        backHref={flow.listPath}
      />
      <WorkspaceSyncStatusBanner projectId={projectId} store="management" />
      <ScriptDownstreamPipelineGuard projectId={projectId} mode="management" />
      {children}
    </div>
  );
}
