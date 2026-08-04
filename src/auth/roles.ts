import type { AuthUser } from "@/auth/types";

/** 系统级角色（由 AuthUser.role 映射；缺省 USER，绝不为 SYSTEM_ADMIN） */
export type SystemRole = "SYSTEM_ADMIN" | "USER";

/**
 * 项目有效角色优先级：
 * SYSTEM_ADMIN > PROJECT_OWNER > CARD_ENGINEER > NONE
 */
export type EffectiveProjectRole =
  | "SYSTEM_ADMIN"
  | "PROJECT_OWNER"
  | "CARD_ENGINEER"
  | "NONE";

export type ProjectMemberRole = "CARD_ENGINEER";

export type ProjectMemberRecord = {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  createdAt: string;
  createdBy: string;
};

export function getSystemRole(user: {
  role?: string | null;
}): SystemRole {
  // 缺省 / 非法角色一律 USER；绝不能默认 SYSTEM_ADMIN
  return user.role === "admin" ? "SYSTEM_ADMIN" : "USER";
}

export function isSystemAdmin(user: AuthUser): boolean {
  return getSystemRole(user) === "SYSTEM_ADMIN";
}

export type WorkspaceFeature =
  | "assets"
  | "storyboard"
  | "video"
  | "script"
  | "project_settings"
  | "member_management";

export function workspaceFeaturesForRole(
  role: EffectiveProjectRole,
): readonly WorkspaceFeature[] {
  if (role === "SYSTEM_ADMIN" || role === "PROJECT_OWNER") {
    return ["assets", "storyboard", "video"] as const;
  }
  if (role === "CARD_ENGINEER") {
    return ["assets"] as const;
  }
  return [] as const;
}

export function canAccessProjectManagementNav(
  systemRole: SystemRole,
  ownsAnyProject: boolean,
  assignedProjectCount = 0,
): boolean {
  return (
    systemRole === "SYSTEM_ADMIN" ||
    ownsAnyProject ||
    assignedProjectCount === 0
  );
}
