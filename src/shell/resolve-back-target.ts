import {
  APP_ADMIN_PATH,
  APP_ASSET_MARKET_PATH,
  APP_INFINITE_CANVAS_PATH,
  APP_PROJECTS_PATH,
  APP_SHELL_ROOT,
  APP_WORKBENCH_PATH,
} from "@/shell/nav";

export type BackTarget =
  | { kind: "hide" }
  | { kind: "href"; href: string };

/**
 * 登录后各模块的返回目标：始终指向明确的上一级路由。
 * 不用 history.back，避免中间 redirect / 多余历史条目导致要点两次。
 */
export function resolveBackTarget(pathname: string): BackTarget {
  if (!pathname || pathname === APP_SHELL_ROOT) {
    return { kind: "hide" };
  }

  // 工作台：资产设计 / 资产库 / 资产入口 / 分镜 → 工作台列表（不再经过空壳项目概览）
  const workspaceAssetsDeep = pathname.match(
    /^\/app\/workspace\/projects\/([^/]+)\/assets(?:\/(?:design|library))?\/?$/,
  );
  if (workspaceAssetsDeep) {
    return {
      kind: "href",
      href: APP_WORKBENCH_PATH,
    };
  }

  const workspaceStoryboard = pathname.match(
    /^\/app\/workspace\/projects\/([^/]+)\/storyboard\/?$/,
  );
  if (workspaceStoryboard) {
    return {
      kind: "href",
      href: APP_WORKBENCH_PATH,
    };
  }

  const workspaceProject = pathname.match(
    /^\/app\/workspace\/projects\/([^/]+)\/?$/,
  );
  if (workspaceProject) {
    return { kind: "href", href: APP_WORKBENCH_PATH };
  }

  // 个人空间项目内各阶段返回项目文件夹列表
  const projectStageMatch = pathname.match(
    /^\/app\/projects\/([^/]+)\/(story|script|assets(?:\/(?:design|library))?|storyboard|breakdown)\/?$/,
  );
  if (projectStageMatch) {
    return {
      kind: "href",
      href: APP_PROJECTS_PATH,
    };
  }

  // 项目详情 → 项目管理列表
  if (pathname.startsWith(`${APP_PROJECTS_PATH}/`)) {
    return { kind: "href", href: APP_PROJECTS_PATH };
  }

  if (pathname.startsWith(`${APP_ADMIN_PATH}/`)) {
    return { kind: "href", href: APP_ADMIN_PATH };
  }

  // 一级模块 → 门户根
  const moduleRoots = [
    APP_PROJECTS_PATH,
    APP_INFINITE_CANVAS_PATH,
    APP_ASSET_MARKET_PATH,
    APP_WORKBENCH_PATH,
    "/app/materials",
    "/app/guide",
    "/app/team",
    APP_ADMIN_PATH,
  ];
  if (moduleRoots.includes(pathname)) {
    return { kind: "href", href: APP_SHELL_ROOT };
  }

  if (pathname.startsWith("/app/")) {
    return { kind: "href", href: APP_SHELL_ROOT };
  }

  return { kind: "hide" };
}
