"use client";

import { redirect, useParams } from "next/navigation";
import { projectManagementPath } from "@/shell/nav";

export default function ProjectAssetsDesignPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  if (!projectId) {
    return (
      <div className="amw">
        <p>缺少项目 ID</p>
      </div>
    );
  }

  redirect(`${projectManagementPath(projectId)}/assets/library`);
}
