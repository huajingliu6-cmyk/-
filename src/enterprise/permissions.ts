import type {
  EnterpriseJobRole,
  EnterpriseMember,
  EnterpriseMemberRole,
} from "@/enterprise/types";

export type EnterprisePermission =
  | "enterprise.read"
  | "members.manage_jobs"
  | "members.manage_admins"
  | "members.remove"
  | "join_requests.review"
  | "projects.assign"
  | "approvals.read"
  | "audit.read";

export const ENTERPRISE_JOB_ROLE_LABELS: Record<EnterpriseJobRole, string> = {
  PRODUCER: "制片人",
  DIRECTOR: "导演",
  WRITER: "编剧",
  ART_DESIGNER: "美术设计",
  STORYBOARD_ARTIST: "分镜师",
  CARD_ENGINEER: "抽卡工程师",
  POST_PRODUCTION: "后期制作",
};

export const ENTERPRISE_ROLE_LABELS: Record<EnterpriseMemberRole, string> = {
  OWNER: "企业所有者",
  ADMIN: "企业管理员",
  MEMBER: "企业成员",
};

export function enterprisePermissionsForMember(
  member: EnterpriseMember,
): readonly EnterprisePermission[] {
  const common: EnterprisePermission[] = ["enterprise.read"];
  if (member.enterpriseRole === "OWNER") {
    return [
      ...common,
      "members.manage_jobs",
      "members.manage_admins",
      "members.remove",
      "join_requests.review",
      "projects.assign",
      "approvals.read",
      "audit.read",
    ];
  }
  if (member.enterpriseRole === "ADMIN") {
    return [
      ...common,
      "members.manage_jobs",
      "members.remove",
      "join_requests.review",
      "projects.assign",
      "approvals.read",
      "audit.read",
    ];
  }
  return common;
}

export function hasEnterprisePermission(
  member: EnterpriseMember | null | undefined,
  permission: EnterprisePermission,
): boolean {
  return Boolean(member && enterprisePermissionsForMember(member).includes(permission));
}
