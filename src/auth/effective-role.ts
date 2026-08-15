import "server-only";
import type { AuthUser } from "@/auth/types";
import {
  getSystemRole,
  type EffectiveProjectRole,
  workspaceFeaturesForRole,
  type WorkspaceFeature,
} from "@/auth/roles";
import { findProjectMember, listMembershipsForUser } from "@/auth/project-members";
import {
  listProjectIdsOwnedViaEnterprise,
  userIsEnterpriseOwnerForProject,
} from "@/enterprise/project-principal";
import { getProjectRecord, listProjectRecords } from "@/projects/project-access";

export type ResolvedProjectAccess = {
  role: EffectiveProjectRole;
  projectId: string;
  ownerId: string;
  features: readonly WorkspaceFeature[];
};

/**
 * 统一解析当前用户对某项目的有效角色。
 * PROJECT_OWNER：Project.ownerId，或挂靠该项目的企业所有者（与主理人同权）。
 * 不从 ProjectMember 读取 PROJECT_OWNER。
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

  if (await userIsEnterpriseOwnerForProject(userId, projectId)) {
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
  const features =
    role !== "NONE" && !project.approvalEnabled
      ? workspaceFeaturesForRole("PROJECT_OWNER")
      : workspaceFeaturesForRole(role);
  return {
    role,
    projectId,
    ownerId: project.ownerId,
    features,
  };
}

export async function userOwnsAnyProject(userId: string): Promise<boolean> {
  const records = await listProjectRecords();
  if (records.some((r) => r.ownerId === userId)) return true;
  const viaEnterprise = await listProjectIdsOwnedViaEnterprise(userId);
  return viaEnterprise.length > 0;
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
  const viaEnterprise = await listProjectIdsOwnedViaEnterprise(user.id);
  const memberships = await listMembershipsForUser(user.id);
  const memberIds = memberships.map((m) => m.projectId);
  return [...new Set([...owned, ...viaEnterprise, ...memberIds])];
}

export async function listManagedProjectIdsForUser(
  user: AuthUser,
): Promise<string[] | "all"> {
  if (getSystemRole(user) === "SYSTEM_ADMIN") return "all";
  const records = await listProjectRecords();
  const owned = records
    .filter((r) => r.ownerId === user.id)
    .map((r) => r.projectId);
  const viaEnterprise = await listProjectIdsOwnedViaEnterprise(user.id);
  return [...new Set([...owned, ...viaEnterprise])];
}

export function hasWorkspaceFeature(
  access: ResolvedProjectAccess,
  feature: WorkspaceFeature,
): boolean {
  return access.features.includes(feature);
}
