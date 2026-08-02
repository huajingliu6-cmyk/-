"use client";

import Link from "next/link";
import {
  projectManagementPath,
  workspaceProjectAssetsPath,
} from "@/shell/nav";

export type AssetModuleId = "design" | "library";

export type AssetModuleNavContext = "management" | "workspace";

type Props = {
  projectId: string;
  active: AssetModuleId;
  /** 默认 management；工作台传 workspace */
  context?: AssetModuleNavContext;
  /** CARD_ENGINEER 设为 false，只显示资产库 */
  showDesign?: boolean;
};

const MODULES: Array<{ id: AssetModuleId; label: string; segment: string }> = [
  { id: "design", label: "资产设计确认", segment: "design" },
  { id: "library", label: "资产库", segment: "library" },
];

export function AssetModuleNav({
  projectId,
  active,
  context = "management",
  showDesign = true,
}: Props) {
  const base =
    context === "workspace"
      ? workspaceProjectAssetsPath(projectId)
      : `${projectManagementPath(projectId)}/assets`;
  const modules = showDesign
    ? MODULES
    : MODULES.filter((mod) => mod.id === "library");

  return (
    <nav className="amn" aria-label="项目资产模块">
      {modules.map((mod) => {
        const href = `${base}/${mod.segment}`;
        const isActive = mod.id === active;
        return (
          <Link
            key={mod.id}
            href={href}
            className={`amn-link${isActive ? " is-active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            {mod.label}
          </Link>
        );
      })}
    </nav>
  );
}
