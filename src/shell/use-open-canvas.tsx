"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import { readCurrentProjectId, writeCurrentProjectId } from "@/shell/current-project-context";
import { ProjectPickerDialog } from "@/shell/ProjectPickerDialog";
import { workflowEditorPath } from "@/shell/nav";

export function useOpenCanvas() {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);

  const navigateToCanvas = useCallback(
    (projectId: string) => {
      writeCurrentProjectId(projectId);
      setPickerOpen(false);
      router.push(workflowEditorPath(projectId));
    },
    [router],
  );

  const openCanvas = useCallback(async () => {
    const currentId = readCurrentProjectId();
    if (currentId) {
      try {
        const response = await fetch(
          `/api/workspace/projects/${encodeURIComponent(currentId)}/video-access`,
          { credentials: "include" },
        );
        if (response.ok) {
          navigateToCanvas(currentId);
          return;
        }
      } catch {
        /* open picker */
      }
    }
    setPickerOpen(true);
  }, [navigateToCanvas]);

  const picker = (
    <ProjectPickerDialog
      open={pickerOpen}
      title="选择项目画布"
      description="请选择一个有视频制作画布访问权限的项目。"
      onClose={() => setPickerOpen(false)}
      onSelect={(project) => navigateToCanvas(project.projectId)}
    />
  );

  return { openCanvas, picker };
}

export async function checkVideoCanvasAccess(projectId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/workspace/projects/${encodeURIComponent(projectId)}/video-access`,
      { credentials: "include" },
    );
    if (!response.ok) {
      await parseResponseJson(response, { allowEmpty: true });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
