"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { RouteLoadingOverlay } from "@/shell/RouteLoadingOverlay";
import {
  confirmGenerationLeaveIfNeeded,
  shouldBlockGenerationLeave,
} from "@/shell/generation-busy";

type StageLink = {
  id: string;
  step: string;
  label: string;
  href: string;
  activePrefix?: string;
};

type Props = {
  projectId: string;
  mode: "management" | "workspace";
  scriptHref?: string;
  placement?: "header" | "page";
};

export function ProjectStageNavLinks({
  projectId,
  mode,
  scriptHref = `/app/projects/${encodeURIComponent(projectId)}/script`,
  placement = "page",
}: Props) {
  const pathname = usePathname();
  const [pendingNavigation, setPendingNavigation] = useState<{
    stageId: string;
    fromPathname: string;
    startedAt: number;
  } | null>(null);
  const [navTimedOut, setNavTimedOut] = useState(false);

  useEffect(() => {
    if (!pendingNavigation) {
      setNavTimedOut(false);
      return;
    }
    if (pathname !== pendingNavigation.fromPathname) {
      setPendingNavigation(null);
      setNavTimedOut(false);
    }
  }, [pathname, pendingNavigation]);

  useEffect(() => {
    if (!pendingNavigation) return;
    setNavTimedOut(false);
    const timer = window.setTimeout(() => setNavTimedOut(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [pendingNavigation]);
  const encodedProjectId = encodeURIComponent(projectId);
  const stages: StageLink[] =
    mode === "management"
      ? [
          { id: "script", step: "01", label: "剧本创作", href: scriptHref },
          {
            id: "assets",
            step: "02",
            label: "项目资产",
            href: `/app/projects/${encodedProjectId}/assets/library`,
            activePrefix: `/app/projects/${encodedProjectId}/assets`,
          },
          {
            id: "storyboard",
            step: "03",
            label: "分镜创作",
            href: `/app/projects/${encodedProjectId}/storyboard`,
          },
        ]
      : [
          {
            id: "assets",
            step: "02",
            label: "项目资产",
            href: `/app/workspace/projects/${encodedProjectId}/assets`,
          },
          {
            id: "storyboard",
            step: "03",
            label: "分镜创作",
            href: `/app/workspace/projects/${encodedProjectId}/storyboard`,
          },
        ];

  return (
    <>
      <nav
        className={`project-stage-nav project-stage-nav--${mode}${
          placement === "header" ? " project-stage-nav--header" : ""
        }`}
        aria-label="一栈式项目阶段"
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
                if (pendingNavigation && stage.id !== pendingNavigation.stageId) {
                  setPendingNavigation(null);
                  setNavTimedOut(false);
                }
                if (shouldBlockGenerationLeave(stage.href)) {
                  event.preventDefault();
                  void confirmGenerationLeaveIfNeeded(stage.href);
                  return;
                }
                if (!isActive && stage.id === "storyboard") {
                  setPendingNavigation({
                    stageId: stage.id,
                    fromPathname: pathname,
                    startedAt: Date.now(),
                  });
                }
              }}
            >
              <span className="project-stage-nav__step">{stage.step}</span>
              <span className="project-stage-nav__label">{stage.label}</span>
            </Link>
          );
        })}
      </nav>
      {pendingNavigation?.stageId === "storyboard" &&
      pendingNavigation.fromPathname === pathname ? (
        <div className="route-loading-timeout-wrap">
          <RouteLoadingOverlay
            title={
              navTimedOut ? "分镜创作加载时间较长" : "正在进入分镜创作"
            }
            description={
              navTimedOut
                ? "页面可能仍在加载，你可以重试或继续等待。"
                : "正在准备分镜创作工作区，请稍候"
            }
          />
          {navTimedOut ? (
            <div
              className="route-loading-timeout-actions"
              data-testid="storyboard-nav-timeout-actions"
            >
              <button
                type="button"
                className="amw-btn"
                onClick={() => {
                  setPendingNavigation(null);
                  setNavTimedOut(false);
                  window.location.assign(
                    stages.find((s) => s.id === "storyboard")?.href ?? pathname,
                  );
                }}
              >
                重试
              </button>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                onClick={() => setNavTimedOut(false)}
              >
                继续等待
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
