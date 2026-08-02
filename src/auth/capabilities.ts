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
  if (getSystemRole(user) === "SYSTEM_ADMIN") {
    return [
      "createProject",
      "editProjectHighlightsAsPrincipal",
      "generateProjectContent",
    ] as const;
  }
  // 项目主理人：可编辑自己项目要点与生成内容；创建项目仍限系统管理员
  return [
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

/** 是否有权新建项目（系统管理员） */
export function canCreateProject(user: AuthUser): boolean {
  return getSystemRole(user) === "SYSTEM_ADMIN";
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
