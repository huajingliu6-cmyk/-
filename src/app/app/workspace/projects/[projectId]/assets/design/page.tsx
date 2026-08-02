"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { EpisodeAssetDesignWorkspace } from "@/projects/assets/EpisodeAssetDesignWorkspace";
import { WorkspaceAssetsPage } from "@/projects/assets/WorkspaceAssetsPage";

function DesignBody({ projectId }: { projectId: string }) {
  return (
    <div data-testid="workspace-assets-design-page">
      <WorkspaceAssetsPage
        projectId={projectId}
        module="design"
        showDesign
      >
        <EpisodeAssetDesignWorkspace projectId={projectId} />
      </WorkspaceAssetsPage>
    </div>
  );
}

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

  return (
    <Suspense fallback={<div className="amw"><p>加载中…</p></div>}>
      <DesignBody projectId={projectId} />
    </Suspense>
  );
}
