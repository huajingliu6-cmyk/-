"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { ShellGlobalAccountBar } from "@/shell/ShellGlobalAccountBar";
import { RouteLoadingOverlay } from "@/shell/RouteLoadingOverlay";
import { writeCurrentProjectId } from "@/shell/current-project-context";
import { useAuthUser } from "@/shell/useAuthUser";
import { PersonalSidebarHubLayout } from "@/personal/ui/PersonalSidebarHubLayout";
import { useWorkflowStore } from "@/workflow/store";
import "@/personal/ui/personal-hub-shell.css";
import "@/shell/shell.css";
import "@/shell/workflow-entry.css";

const WorkflowEditor = dynamic(
  () =>
    import("@/workflow/components/WorkflowEditor").then((mod) => ({
      default: mod.WorkflowEditor,
    })),
  {
    ssr: false,
    loading: () => (
      <RouteLoadingOverlay
        title="正在加载视频画布…"
        description="按需加载 React Flow 编辑器，不阻塞首屏壳层"
      />
    ),
  },
);

/**
 * 仅在服务端通过 requireVideoCanvasAccess 后挂载。
 */
export function WorkflowCanvasClient({ projectId }: { projectId: string }) {
  const auth = useAuthUser();
  const setProjectId = useWorkflowStore((s) => s.setProjectId);
  const currentId = useWorkflowStore((s) => s.projectId);

  useEffect(() => {
    writeCurrentProjectId(projectId, "canvas");
    if (projectId && projectId !== currentId) {
      setProjectId(projectId);
    }
  }, [projectId, currentId, setProjectId]);

  return (
    <div className="workflow-app-shell" data-testid="workflow-canvas-shell">
      {auth.status === "authenticated" ? (
        <header className="shell-header shell-header--workflow">
          <div className="shell-header__inner">
            <div className="shell-header__lead">
              <h1>视频制作画布</h1>
              <span>项目 {projectId}</span>
            </div>
            <ShellGlobalAccountBar user={auth.user} />
          </div>
        </header>
      ) : null}

      <PersonalSidebarHubLayout activeId="canvas">
        <div
          className="workflow-shell"
          data-testid="workflow-canvas-allowed"
        >
          <div className="min-h-0 flex-1 overflow-hidden">
            <WorkflowEditor key={projectId} />
          </div>
        </div>
      </PersonalSidebarHubLayout>
    </div>
  );
}
