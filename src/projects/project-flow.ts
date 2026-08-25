import type { ProjectMode } from "@/projects/types";
import {
  APP_INFINITE_CANVAS_PATH,
  APP_PROJECTS_PATH,
} from "@/shell/nav";

export type ProjectFlowKind = "full-stack" | "canvas";

export type ProjectFlowConfig = {
  kind: ProjectFlowKind;
  title: string;
  subtitle: string;
  listPath: string;
  projectMode: ProjectMode;
  emptyTitle: string;
};

export const FULL_STACK_FLOW: ProjectFlowConfig = {
  kind: "full-stack",
  title: "一栈式Flow",
  subtitle: "剧本上传、项目资产与分镜创作三阶段流程。",
  listPath: APP_PROJECTS_PATH,
  projectMode: "full-stack",
  emptyTitle: "暂无一栈式项目",
};

export const INFINITE_CANVAS_FLOW: ProjectFlowConfig = {
  kind: "canvas",
  title: "无限画布",
  subtitle: "管理画布项目、查看创作进度并继续上次创作。",
  listPath: APP_INFINITE_CANVAS_PATH,
  projectMode: "canvas",
  emptyTitle: "暂无无限画布项目",
};

export function projectFlowConfigForMode(
  projectMode: ProjectMode,
): ProjectFlowConfig {
  return projectMode === "canvas" ? INFINITE_CANVAS_FLOW : FULL_STACK_FLOW;
}
