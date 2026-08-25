"use client";

import { GlobalBackButton } from "@/shell/GlobalBackButton";
import { useProjectFlowHeader } from "@/shell/project-flow-header-context";
import { ProjectStageNavLinks } from "@/projects/workbench/ProjectStageNavLinks";

type ProjectStageNavProps = {
  projectId: string;
  mode: "management" | "workspace";
  scriptHref?: string;
  brandLabel: string;
  backHref: string;
};

export function ProjectStageNav({
  projectId,
  mode,
  scriptHref = `/app/projects/${encodeURIComponent(projectId)}/script`,
  brandLabel,
  backHref,
}: ProjectStageNavProps) {
  const flowHeader = useProjectFlowHeader();
  const showInlineStages = !flowHeader;

  if (flowHeader) {
    return null;
  }

  return (
    <div className="project-stage-nav-shell" data-testid={`${mode}-one-stack-nav`}>
      <div className="project-stage-nav__brand">
        {showInlineStages ? (
          <GlobalBackButton showDivider={false} href={backHref} />
        ) : null}
        <div className="project-stage-nav__brand-copy">
          <span className="project-stage-nav__brand-label">{brandLabel}</span>
          {!showInlineStages ? null : (
            <span className="project-stage-nav__brand-hint">
              {mode === "management"
                ? "剧本创作 → 项目资产 → 分镜创作"
                : "项目资产 → 分镜创作"}
            </span>
          )}
        </div>
      </div>
      {showInlineStages ? (
        <ProjectStageNavLinks
          projectId={projectId}
          mode={mode}
          scriptHref={scriptHref}
          placement="page"
        />
      ) : null}
    </div>
  );
}
