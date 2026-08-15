"use client";

import { redirect, useParams } from "next/navigation";
import { workspaceProjectAssetsLibraryPath } from "@/shell/nav";

export default function WorkspaceProjectAssetsDesignPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  if (!projectId) {
    return (
      <div className="amw">
        <p>缺少项目 ID</p>
      </div>
    );
  }

  redirect(workspaceProjectAssetsLibraryPath(projectId));
}
