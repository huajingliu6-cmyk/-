"use client";

import { useEffect } from "react";
import { WorkflowEditor } from "@/workflow/components/WorkflowEditor";
import { useWorkflowStore } from "@/workflow/store";

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
      <div className="flex h-11 shrink-0 items-center border-b border-white/10 px-4">
        <h1 className="text-sm font-semibold tracking-wide text-white/85">
          视频制作画布
        </h1>
        <span className="ml-3 truncate text-xs text-white/40">
          项目 {projectId}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkflowEditor key={projectId} />
      </div>
    </div>
  );
}
