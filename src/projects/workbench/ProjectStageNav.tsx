"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { RouteLoadingOverlay } from "@/shell/RouteLoadingOverlay";
import {
  confirmGenerationLeaveIfNeeded,
  isGenerationBusy,
} from "@/shell/generation-busy";

type ProjectStageNavProps = {
  projectId: string;
  mode: "management" | "workspace";
  scriptHref?: string;
};

type StageLink = {
  id: string;
  label: string;
  href: string;
  activePrefix?: string;
};

export function ProjectStageNav({
  projectId,
  mode,
  scriptHref = `/app/projects/${encodeURIComponent(projectId)}/script`,
}: ProjectStageNavProps) {
  const pathname = usePathname();
  const [pendingNavigation, setPendingNavigation] = useState<{
    stageId: string;
    fromPathname: string;
  } | null>(null);
  const encodedProjectId = encodeURIComponent(projectId);
  const stages: StageLink[] =
    mode === "management"
      ? [
          { id: "script", label: "剧本创作", href: scriptHref },
          {
            id: "assets",
            label: "项目资产",
            href: `/app/projects/${encodedProjectId}/assets/library`,
            activePrefix: `/app/projects/${encodedProjectId}/assets`,
          },
          {
            id: "storyboard",
            label: "分镜创作",
            href: `/app/projects/${encodedProjectId}/storyboard`,
          },
        ]
      : [
          {
            id: "assets",
            label: "项目资产",
            href: `/app/workspace/projects/${encodedProjectId}/assets`,
          },
          {
            id: "storyboard",
            label: "分镜创作",
            href: `/app/workspace/projects/${encodedProjectId}/storyboard`,
          },
        ];

  return (
    <>
      <nav
        className={`project-stage-nav project-stage-nav--${mode}`}
        aria-label="项目阶段"
        data-testid={`${mode}-stage-nav`}
      >
        {stages.map((stage) => {
          const activePrefix = stage.activePrefix ?? stage.href;
          const isActive =
            pathname === stage.href || pathname.startsWith(`${activePrefix}/`);
          return (
            <Link
              key={stage.id}
              className={`project-stage-nav__link${isActive ? " is-active" : ""}`}
              href={stage.href}
              prefetch={false}
              aria-current={isActive ? "page" : undefined}
              data-testid={`${mode}-nav-${stage.id}`}
              onClick={(event) => {
                if (isGenerationBusy()) {
                  event.preventDefault();
                  void confirmGenerationLeaveIfNeeded(stage.href);
                  return;
                }
                if (!isActive && stage.id === "storyboard") {
                  setPendingNavigation({
                    stageId: stage.id,
                    fromPathname: pathname,
                  });
                }
              }}
            >
              {stage.label}
            </Link>
          );
        })}
      </nav>
      {pendingNavigation?.stageId === "storyboard" &&
      pendingNavigation.fromPathname === pathname ? (
        <RouteLoadingOverlay
          title="正在进入分镜创作"
          description="正在准备分镜创作工作区，请稍候"
        />
      ) : null}
    </>
  );
}
