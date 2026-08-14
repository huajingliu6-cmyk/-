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
    <div className={`amw amw--${module}${module === "library" ? " amw--library-scroll" : ""}`}>
      <div className="amw-inner">
        <AssetModuleNav
          projectId={projectId}
          active={module}
          context={context}
          showDesign={showDesign}
        />
        <div className={module === "library" ? "amw-shell-main" : undefined}>
          {children}
        </div>
      </div>
    </div>
  );
}
