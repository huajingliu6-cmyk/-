import type { AuthUser } from "@/auth/types";
import { getSystemRole } from "@/auth/roles";

/**
 * 业务能力（统一经 systemRole / owner 判定，调用方勿硬编码 role 字符串）。
 * 本模块可被客户端安全导入；异步项目成员查询请用 require-access / effective-role。
 */
export type Capability =
  | "createProject"
  | "editProjectHighlightsAsPrincipal"
  | "generateProjectContent";

export function listCapabilities(user: AuthUser): readonly Capability[] {
  void user;
  return [
    "createProject",
    "editProjectHighlightsAsPrincipal",
    "generateProjectContent",
  ] as const;
}

export function hasCapability(
  user: AuthUser,
  capability: Capability,
): boolean {
  return listCapabilities(user).includes(capability);
}

/** 每个已登录账号都可以在个人空间创建自己的项目。 */
export function canCreateProject(user: AuthUser): boolean {
  void user;
  return true;
}

/**
 * 是否可编辑某项目的「项目要点」。
 * 规则：系统管理员，或该项目 ownerId。
 */
export function canEditProjectHighlights(
  user: AuthUser,
  projectOwnerId: string,
): boolean {
  if (getSystemRole(user) === "SYSTEM_ADMIN") return true;
  return user.id === projectOwnerId;
}

/**
 * @deprecated 请改用 resolveEffectiveProjectRole / requireWorkspace*。
 * 保留兼容：系统管理员或项目主理人。
 */
export function canGenerateProjectContent(
  user: AuthUser,
  projectOwnerId: string,
): boolean {
  if (getSystemRole(user) === "SYSTEM_ADMIN") return true;
  return user.id === projectOwnerId;
}
