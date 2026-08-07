"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { AppearanceButton } from "@/shell/AppearanceProvider";
import { RouteLoadingOverlay } from "@/shell/RouteLoadingOverlay";
import { useWorkflowStore } from "@/workflow/store";

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
 * 不回退 DEMO_PROJECT_ID，避免无 projectId / 抽卡工程师绕过。
 */
export function WorkflowCanvasClient({ projectId }: { projectId: string }) {
  const setProjectId = useWorkflowStore((s) => s.setProjectId);
  const currentId = useWorkflowStore((s) => s.projectId);

  useEffect(() => {
    if (projectId && projectId !== currentId) {
      setProjectId(projectId);
    }
  }, [projectId, currentId, setProjectId]);

  return (
    <div
      className="flex h-svh w-full flex-col overflow-hidden bg-[#070811]"
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
  );
}
