"use client";

import { useParams } from "next/navigation";
import { AssetManagementWorkspace } from "@/projects/assets/AssetManagementWorkspace";
import { WorkspaceAssetsPage } from "@/projects/assets/WorkspaceAssetsPage";

export default function WorkspaceProjectAssetsLibraryPage() {
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
    <div data-testid="workspace-assets-page">
      <WorkspaceAssetsPage projectId={projectId} module="library">
        <AssetManagementWorkspace
          key={projectId}
          projectId={projectId}
          context="workspace"
          embedded
        />
      </WorkspaceAssetsPage>
    </div>
  );
}
