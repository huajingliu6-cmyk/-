"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectPickerDialog } from "@/shell/ProjectPickerDialog";
import { PersonalSidebarHubLayout } from "@/personal/ui/PersonalSidebarHubLayout";
import { workflowEditorPath } from "@/shell/nav";
import "@/personal/ui/personal-hub-shell.css";
import "@/shell/workflow-entry.css";

export function WorkflowMissingProject() {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(true);

  return (
    <PersonalSidebarHubLayout activeId="canvas" testId="workflow-entry-shell">
      <div className="workflow-entry" data-testid="workflow-missing-project">
        <h1>视频制作画布</h1>
        <p>请先选择一个项目，再进入画布编排镜头与生成视频。</p>
        <button
          type="button"
          className="hub-btn hub-btn--primary"
          onClick={() => setPickerOpen(true)}
        >
          选择项目
        </button>
      </div>
      <ProjectPickerDialog
        open={pickerOpen}
        title="选择项目画布"
        description="请选择一个有视频制作画布访问权限的项目。"
        onClose={() => {
          setPickerOpen(false);
          router.push("/app");
        }}
        onSelect={(project) =>
          router.push(workflowEditorPath(project.projectId))
        }
      />
    </PersonalSidebarHubLayout>
  );
}
