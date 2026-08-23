export type ShellNavItem = {
  id: string;
  label: string;
  href: string;
};

/** 登录后应用壳层根路径（空白门户） */
export const APP_SHELL_ROOT = "/app";

/** 平台工作台（最近项目与进度总览，不是画布） */
export const APP_WORKBENCH_PATH = "/app/workspace";

/** 项目管理列表 */
export const APP_PROJECTS_PATH = "/app/projects";

/**
 * 登录/注册成功后的默认落地页。
 * 不用空白门户 /app，避免「登录成功却像没进去」。
 */
export const APP_POST_LOGIN_PATH = APP_PROJECTS_PATH;

/** 视频制作画布（React Flow / WorkflowEditor） */
export const WORKFLOW_EDITOR_PATH = "/workflow";

/** 系统管理员独立页（平台级 AI / API 配置） */
export const APP_ADMIN_PATH = "/app/admin";

/** 登录后业务导航 → /app 子路由（完整列表；实际展示由权限过滤） */
export const AUTH_NAV_ITEMS: ShellNavItem[] = [
  { id: "projects", label: "项目管理", href: APP_PROJECTS_PATH },
  {
    id: "enterprise-assets",
    label: "企业素材库",
    href: "/app/enterprise-assets",
  },
  { id: "workspace", label: "工作台", href: APP_WORKBENCH_PATH },
  { id: "materials", label: "素材引擎", href: "/app/materials" },
  { id: "guide", label: "创作指引", href: "/app/guide" },
  { id: "team", label: "团队管理", href: "/app/team" },
  {
    id: "admin-materials",
    label: "管理素材",
    href: "/app/admin/materials",
  },
  { id: "admin", label: "系统管理", href: APP_ADMIN_PATH },
];

/** 抽卡工程师仅可见工作台 */
export const CARD_ENGINEER_NAV_IDS = ["workspace"] as const;

/** 项目管理侧项目详情（项目管理模块） */
export function projectManagementPath(projectId: string): string {
  return `${APP_PROJECTS_PATH}/${encodeURIComponent(projectId)}`;
}

/** @deprecated 使用 projectManagementPath；保留别名避免遗漏引用 */
export function projectWorkbenchPath(projectId: string): string {
  return projectManagementPath(projectId);
}

/** 工作台下的项目页 */
export function workspaceProjectPath(projectId: string): string {
  return `${APP_WORKBENCH_PATH}/projects/${encodeURIComponent(projectId)}`;
}

/** 工作台下的项目资产页（入口；按角色 redirect 到 design / library） */
export function workspaceProjectAssetsPath(projectId: string): string {
  return `${workspaceProjectPath(projectId)}/assets`;
}

/** @deprecated 资产设计已合并到资产管理页。 */
export function workspaceProjectAssetsDesignPath(projectId: string): string {
  return workspaceProjectAssetsLibraryPath(projectId);
}

/** 工作台资产库 */
export function workspaceProjectAssetsLibraryPath(projectId: string): string {
  return `${workspaceProjectAssetsPath(projectId)}/library`;
}

/** 工作台下的分镜创作页 */
export function workspaceProjectStoryboardPath(projectId: string): string {
  return `${workspaceProjectPath(projectId)}/storyboard`;
}

/** 视频制作画布路径（携带 projectId） */
export function workflowEditorPath(projectId: string): string {
  return `${WORKFLOW_EDITOR_PATH}?projectId=${encodeURIComponent(projectId)}`;
}
