"use client";

import type { ReactNode } from "react";
import {
  AssetModuleNav,
  type AssetModuleId,
  type AssetModuleNavContext,
} from "@/projects/assets/AssetModuleNav";
import "@/projects/assets/asset-workspace.css";

type Props = {
  projectId: string;
  module: AssetModuleId;
  children: ReactNode;
  context?: AssetModuleNavContext;
  showDesign?: boolean;
};

export function ProjectAssetsShell({
  projectId,
  module,
  children,
  context = "management",
  showDesign = true,
}: Props) {
  return (
    <div className="amw">
      <div className="amw-inner">
        <header className="amw-head amw-head--shell">
          <div className="amw-head__titles">
            <h1>项目资产管理</h1>
            <p>按剧集完成资产设计确认，并统一沉淀到项目资产库。</p>
          </div>
        </header>
        <AssetModuleNav
          projectId={projectId}
          active={module}
          context={context}
          showDesign={showDesign}
        />
        {children}
      </div>
    </div>
  );
}
