"use client";

import type { ReactNode } from "react";
import type {
  AssetModuleId,
  AssetModuleNavContext,
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
  module,
  children,
}: Props) {
  return (
    <div className={`amw amw--${module}${module === "library" ? " amw--library-scroll" : ""}`}>
      <div className="amw-inner">
        <div className={module === "library" ? "amw-shell-main" : undefined}>
          {children}
        </div>
      </div>
    </div>
  );
}
