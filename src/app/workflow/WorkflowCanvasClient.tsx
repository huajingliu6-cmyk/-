"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { AppearanceButton } from "@/shell/AppearanceProvider";
import { RouteLoadingOverlay } from "@/shell/RouteLoadingOverlay";
import { writeCurrentProjectId } from "@/shell/current-project-context";
import { PersonalSidebarHubLayout } from "@/personal/ui/PersonalSidebarHubLayout";
import { useWorkflowStore } from "@/workflow/store";
import "@/personal/ui/personal-hub-shell.css";
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
  const setProjectId = useWorkflowStore((s) => s.setProjectId);
  const currentId = useWorkflowStore((s) => s.projectId);

  useEffect(() => {
    writeCurrentProjectId(projectId);
    if (projectId && projectId !== currentId) {
      setProjectId(projectId);
    }
  }, [projectId, currentId, setProjectId]);

  return (
    <PersonalSidebarHubLayout activeId="canvas" testId="workflow-canvas-shell">
      <div
        className="workflow-shell"
        data-testid="workflow-canvas-allowed"
      >
        <div className="workflow-topbar flex h-14 shrink-0 items-center border-b border-white/10 px-4">
          <h1 className="text-sm font-semibold tracking-wide text-white/85">
            视频制作画布
          </h1>
          <span className="ml-3 truncate text-xs text-white/40">
            项目 {projectId}
          </span>
          <div className="ml-auto">
            <AppearanceButton compact />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <WorkflowEditor key={projectId} />
        </div>
      </div>
    </PersonalSidebarHubLayout>
  );
}
