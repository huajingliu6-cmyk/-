"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { EpisodeAssetDesignWorkspace } from "@/projects/assets/EpisodeAssetDesignWorkspace";
import { ProjectAssetsManagementPage } from "@/projects/assets/ProjectAssetsManagementPage";
import { RouteLoadingOverlay } from "@/shell/RouteLoadingOverlay";

export default function ProjectAssetsDesignPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  if (!projectId) {
    return <div className="amw"><p>缺少项目 ID</p></div>;
  }

  return (
    <ProjectAssetsManagementPage projectId={projectId} module="design">
      <Suspense
        fallback={
          <RouteLoadingOverlay
            title="正在加载资产设计…"
            description="正在准备剧本资产提取与设计工作区"
          />
        }
      >
        <EpisodeAssetDesignWorkspace projectId={projectId} />
      </Suspense>
    </ProjectAssetsManagementPage>
  );
}
