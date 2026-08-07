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
  const isDesign = module === "design";
  return (
    <div className={`amw amw--${module}`}>
      <div className="amw-inner">
        {!isDesign ? (
          <header className="amw-head amw-head--shell">
            <div className="amw-head__titles">
              <h1>项目资产库</h1>
              <p>统一管理已确认入库的角色、场景、道具与音频资产。</p>
            </div>
          </header>
        ) : null}
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
