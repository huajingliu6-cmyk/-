export type ShellNavItem = {
  id: string;
  label: string;
  href: string;
};

/** 登录后应用壳层根路径（空白门户） */
export const APP_SHELL_ROOT = "/app";

/** 个人素材库 */
export const APP_PERSONAL_ASSETS_PATH = "/app/personal-assets";

/** 素材市场 */
export const APP_ASSET_MARKET_PATH = "/app/asset-market";

/** 平台工作台（最近项目与进度总览，不是画布） */
export const APP_WORKBENCH_PATH = "/app/workspace";

/** 项目管理列表（一栈式 Flow 入口） */
export const APP_PROJECTS_PATH = "/app/projects";

/** 无限画布项目管理列表 */
export const APP_INFINITE_CANVAS_PATH = "/app/infinite-canvas";

/** 系统管理员独立页（平台级 AI / API 配置） */
export const APP_ADMIN_PATH = "/app/admin";

export function isSidebarHubPath(pathname: string): boolean {
  return (
    pathname === APP_SHELL_ROOT ||
    pathname === `${APP_SHELL_ROOT}/` ||
    pathname === APP_PERSONAL_ASSETS_PATH ||
    pathname === APP_ASSET_MARKET_PATH
  );
}

export function isAdminConsolePath(pathname: string): boolean {
  return (
    pathname === APP_ADMIN_PATH ||
    pathname.startsWith(`${APP_ADMIN_PATH}/`)
  );
}

export function shellHeaderVariant(
  pathname: string,
): "full" | "account-only" {
  if (isSidebarHubPath(pathname) || isAdminConsolePath(pathname)) {
    return "account-only";
  }
  return "full";
}

export function isOneStackFlowPath(pathname: string): boolean {
  return (
    pathname === APP_PROJECTS_PATH ||
    pathname.startsWith(`${APP_PROJECTS_PATH}/`)
  );
}

/** 一栈式项目三阶段页面（顶栏显示项目名 + 阶段导航） */
export function isOneStackProjectStagePath(pathname: string): boolean {
  return /^\/app\/projects\/[^/]+\/(script|story|assets|storyboard)(?:\/|$)/.test(
    pathname,
  );
}

export function parseProjectFlowRoute(pathname: string): {
  projectId: string;
  mode: "management" | "workspace";
} | null {
  if (pathname === APP_PROJECTS_PATH) return null;

  const managementMatch = pathname.match(/^\/app\/projects\/([^/]+)(?:\/|$)/);
  if (managementMatch?.[1]) {
    return {
      projectId: decodeURIComponent(managementMatch[1]),
      mode: "management",
    };
  }

  const workspaceMatch = pathname.match(
    /^\/app\/workspace\/projects\/([^/]+)(?:\/|$)/,
  );
  if (workspaceMatch?.[1]) {
    return {
      projectId: decodeURIComponent(workspaceMatch[1]),
      mode: "workspace",
    };
  }

  return null;
}

export function isInfiniteCanvasListPath(pathname: string): boolean {
  return pathname === APP_INFINITE_CANVAS_PATH;
}

/**
 * 登录/注册成功后的默认落地页。
 * 不用空白门户 /app，避免「登录成功却像没进去」。
 */
export const APP_POST_LOGIN_PATH = APP_SHELL_ROOT;

/** 视频制作画布（React Flow / WorkflowEditor） */
export const WORKFLOW_EDITOR_PATH = "/workflow";

/** 登录后业务导航 → /app 子路由（完整列表；实际展示由权限过滤） */
export const AUTH_NAV_ITEMS: ShellNavItem[] = [
  { id: "projects", label: "一栈式Flow", href: APP_PROJECTS_PATH },
  {
    id: "asset-market",
    label: "素材市场",
    href: APP_ASSET_MARKET_PATH,
  },
  { id: "workspace", label: "工作台", href: APP_WORKBENCH_PATH },
  { id: "personal-assets", label: "个人素材", href: APP_PERSONAL_ASSETS_PATH },
  { id: "guide", label: "创作指引", href: "/app/guide" },
  { id: "team", label: "团队管理", href: "/app/team" },
  /**
   * Top global entry for SYSTEM_ADMIN only (filtered by /api/auth/navigation).
   * Renamed from「系统管理」; materials admin is reached via /app/admin?view=materials.
   */
  { id: "admin", label: "API 配置", href: `${APP_ADMIN_PATH}?view=api` },
];

/** Admin-only nav ids stripped for non-SYSTEM_ADMIN users. */
export const ADMIN_NAV_IDS = ["admin", "admin-materials"] as const;

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
