"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { EpisodeAssetDesignWorkspace } from "@/projects/assets/EpisodeAssetDesignWorkspace";
import { ProjectAssetsManagementPage } from "@/projects/assets/ProjectAssetsManagementPage";

function DesignBody({ projectId }: { projectId: string }) {
  return (
    <ProjectAssetsManagementPage projectId={projectId} module="design">
      <EpisodeAssetDesignWorkspace projectId={projectId} />
    </ProjectAssetsManagementPage>
  );
}

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

  return (
    <Suspense fallback={<div className="amw"><p>加载中…</p></div>}>
      <DesignBody projectId={projectId} />
    </Suspense>
  );
}
