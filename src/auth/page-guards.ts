import "server-only";
import { redirect } from "next/navigation";
import { requireSessionUser } from "@/auth/require-user";
import {
  requireProjectManagementAccess,
  requireProjectManagementProjectAccess,
  requireStoryboardAccess,
  requireSystemAdmin,
  requireVideoCanvasAccess,
  requireWorkspaceAssetAccess,
  requireWorkspaceProjectAccess,
} from "@/auth/require-access";
import { APP_WORKBENCH_PATH } from "@/shell/nav";

/**
 * 服务端页面门禁：未登录回首页登录；无权限回工作台。
 * API 仍使用 require-* 返回 401/403 JSON。
 */
export async function assertAuthenticatedPage() {
  const session = await requireSessionUser();
  if (!session.ok) {
    redirect("/?login=1");
  }
  return session.user;
}

export async function assertSystemAdminPage() {
  await assertAuthenticatedPage();
  const gated = await requireSystemAdmin();
  if (!gated.ok) {
    redirect(`${APP_WORKBENCH_PATH}?denied=system-admin`);
  }
  return gated.user;
}

export async function assertProjectManagementPage() {
  await assertAuthenticatedPage();
  const gated = await requireProjectManagementAccess();
  if (!gated.ok) {
    redirect(`${APP_WORKBENCH_PATH}?denied=projects`);
  }
  return gated.user;
}

export async function assertProjectManagementProjectPage(projectId: string) {
  await assertAuthenticatedPage();
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) {
    const status = gated.response.status;
    if (status === 404) {
      redirect(`${APP_WORKBENCH_PATH}?denied=not-found`);
    }
    redirect(`${APP_WORKBENCH_PATH}?denied=project-management`);
  }
  return gated;
}

export async function assertWorkspaceProjectPage(projectId: string) {
  await assertAuthenticatedPage();
  const gated = await requireWorkspaceProjectAccess(projectId);
  if (!gated.ok) {
    const status = gated.response.status;
    if (status === 404) {
      redirect(`${APP_WORKBENCH_PATH}?denied=not-found`);
    }
    redirect(`${APP_WORKBENCH_PATH}?denied=workspace-project`);
  }
  return gated;
}

export async function assertWorkspaceAssetPage(projectId: string) {
  await assertAuthenticatedPage();
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) {
    const status = gated.response.status;
    if (status === 404) {
      redirect(`${APP_WORKBENCH_PATH}?denied=not-found`);
    }
    redirect(`${APP_WORKBENCH_PATH}?denied=workspace-assets`);
  }
  return gated;
}

/** 工作台资产设计：与资产库相同，抽卡工程师可进入 */
export async function assertWorkspaceAssetDesignPage(projectId: string) {
  return assertWorkspaceAssetPage(projectId);
}

export async function assertWorkspaceStoryboardPage(projectId: string) {
  await assertAuthenticatedPage();
  const gated = await requireStoryboardAccess(projectId);
  if (!gated.ok) {
    const status = gated.response.status;
    if (status === 404) {
      redirect(`${APP_WORKBENCH_PATH}?denied=not-found`);
    }
    redirect(`${APP_WORKBENCH_PATH}?denied=workspace-storyboard`);
  }
  return gated;
}

export async function assertVideoCanvasPage(projectId: string) {
  await assertAuthenticatedPage();
  const gated = await requireVideoCanvasAccess(projectId);
  if (!gated.ok) {
    redirect(`${APP_WORKBENCH_PATH}?denied=video-canvas`);
  }
  return gated;
}
