"use client";

import { useParams } from "next/navigation";
import { AssetManagementWorkspace } from "@/projects/assets/AssetManagementWorkspace";
import { ProjectAssetsManagementPage } from "@/projects/assets/ProjectAssetsManagementPage";

export default function ProjectAssetsLibraryPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  if (!projectId) {
    return (
      <div className="amw">
        <p>缺少项目 ID</p>
      </div>
    );
  }

  return (
    <ProjectAssetsManagementPage projectId={projectId} module="library">
      <AssetManagementWorkspace
        key={projectId}
        projectId={projectId}
        context="management"
        embedded
      />
    </ProjectAssetsManagementPage>
  );
}
