import "server-only";
import type { AuthUser } from "@/auth/types";
import {
  getSystemRole,
  type EffectiveProjectRole,
  workspaceFeaturesForRole,
  type WorkspaceFeature,
} from "@/auth/roles";
import { findProjectMember, listMembershipsForUser } from "@/auth/project-members";
import { getProjectRecord, listProjectRecords } from "@/projects/project-access";

export type ResolvedProjectAccess = {
  role: EffectiveProjectRole;
  projectId: string;
  ownerId: string;
  features: readonly WorkspaceFeature[];
};

/**
 * 统一解析当前用户对某项目的有效角色。
 * PROJECT_OWNER 仅以 Project.ownerId 为准，不从 ProjectMember 读取。
 */
export async function resolveEffectiveProjectRole(
  userId: string,
  projectId: string,
  user?: AuthUser | null,
): Promise<EffectiveProjectRole> {
  if (user && getSystemRole(user) === "SYSTEM_ADMIN") {
    return "SYSTEM_ADMIN";
  }
  // 无 user 对象时仍尝试按 id 查系统角色场景由调用方传入 AuthUser
  if (user?.role === "admin") {
    return "SYSTEM_ADMIN";
  }

  const project = await getProjectRecord(projectId);
  if (!project) return "NONE";

  if (project.ownerId === userId) {
    return "PROJECT_OWNER";
  }

  const member = await findProjectMember(projectId, userId);
  if (member?.role === "CARD_ENGINEER") {
    return "CARD_ENGINEER";
  }

  return "NONE";
}

export async function resolveProjectAccess(
  user: AuthUser,
  projectId: string,
): Promise<ResolvedProjectAccess | null> {
  const project = await getProjectRecord(projectId);
  if (!project) return null;
  const role = await resolveEffectiveProjectRole(user.id, projectId, user);
  return {
    role,
    projectId,
    ownerId: project.ownerId,
    features: workspaceFeaturesForRole(role),
  };
}

export async function userOwnsAnyProject(userId: string): Promise<boolean> {
  const records = await listProjectRecords();
  return records.some((r) => r.ownerId === userId);
}

export async function listAccessibleWorkspaceProjectIds(
  user: AuthUser,
): Promise<string[]> {
  const records = await listProjectRecords();
  if (getSystemRole(user) === "SYSTEM_ADMIN") {
    return records.map((r) => r.projectId);
  }

  const owned = records
    .filter((r) => r.ownerId === user.id)
    .map((r) => r.projectId);
  const memberships = await listMembershipsForUser(user.id);
  const memberIds = memberships.map((m) => m.projectId);
  return [...new Set([...owned, ...memberIds])];
}

export async function listManagedProjectIdsForUser(
  user: AuthUser,
): Promise<string[] | "all"> {
  if (getSystemRole(user) === "SYSTEM_ADMIN") return "all";
  const records = await listProjectRecords();
  return records.filter((r) => r.ownerId === user.id).map((r) => r.projectId);
}

export function hasWorkspaceFeature(
  access: ResolvedProjectAccess,
  feature: WorkspaceFeature,
): boolean {
  return access.features.includes(feature);
}
