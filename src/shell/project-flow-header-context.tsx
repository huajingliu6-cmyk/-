"use client";

import { createContext, useContext } from "react";

export type ProjectFlowHeaderConfig = {
  projectId: string;
  mode: "management" | "workspace";
  scriptHref?: string;
  /** null = 尚未加载，空字符串 = 已加载但无名称 */
  projectName: string | null;
};

const ProjectFlowHeaderContext = createContext<ProjectFlowHeaderConfig | null>(
  null,
);

export function ProjectFlowHeaderProvider({
  value,
  children,
}: {
  value: ProjectFlowHeaderConfig | null;
  children: React.ReactNode;
}) {
  return (
    <ProjectFlowHeaderContext.Provider value={value}>
      {children}
    </ProjectFlowHeaderContext.Provider>
  );
}

export function useProjectFlowHeader(): ProjectFlowHeaderConfig | null {
  return useContext(ProjectFlowHeaderContext);
}
