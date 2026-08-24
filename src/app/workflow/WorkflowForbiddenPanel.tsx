"use client";

import { useState } from "react";
import Link from "next/link";
import { ProjectPickerDialog } from "@/shell/ProjectPickerDialog";
import { PersonalSidebarHubLayout } from "@/personal/ui/PersonalSidebarHubLayout";
import { workflowEditorPath } from "@/shell/nav";
import "@/personal/ui/personal-hub-shell.css";
import "@/personal/ui/personal-hub-controls.css";
import "@/shell/workflow-entry.css";

type Props = {
  message: string;
};

export function WorkflowForbiddenPanel({ message }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <PersonalSidebarHubLayout activeId="canvas" testId="workflow-forbidden-shell">
      <div className="workflow-entry" data-testid="workflow-forbidden">
        <h1>无法进入画布</h1>
        <p>{message}</p>
        <div className="workflow-entry__actions">
          <button
            type="button"
            className="hub-btn hub-btn--primary"
            onClick={() => setPickerOpen(true)}
          >
            选择其他项目
          </button>
          <Link href="/app" className="hub-btn hub-btn--glass">
            返回首页
          </Link>
        </div>
      </div>
      <ProjectPickerDialog
        open={pickerOpen}
        title="选择项目画布"
        description="请选择一个有视频制作画布访问权限的项目。"
        onClose={() => setPickerOpen(false)}
        onSelect={(project) => {
          window.location.href = workflowEditorPath(project.projectId);
        }}
      />
    </PersonalSidebarHubLayout>
  );
}
