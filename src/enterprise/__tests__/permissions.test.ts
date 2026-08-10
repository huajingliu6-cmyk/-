import { describe, expect, it } from "vitest";
import {
  enterprisePermissionsForMember,
  hasEnterprisePermission,
} from "@/enterprise/permissions";
import type { EnterpriseMember, EnterpriseMemberRole } from "@/enterprise/types";

function member(enterpriseRole: EnterpriseMemberRole): EnterpriseMember {
  return {
    userId: enterpriseRole.toLowerCase(),
    enterpriseRole,
    jobRole: "PRODUCER",
    joinedAt: "2026-08-10T00:00:00.000Z",
    invitedByUserId: null,
  };
}

describe("enterprise permissions", () => {
  it("gives the owner all organization permissions", () => {
    const permissions = enterprisePermissionsForMember(member("OWNER"));

    expect(permissions).toEqual(
      expect.arrayContaining([
        "members.manage_jobs",
        "members.manage_admins",
        "members.remove",
        "join_requests.review",
        "projects.assign",
        "approvals.read",
        "audit.read",
      ]),
    );
  });

  it("lets admins operate the enterprise without granting other admins", () => {
    const admin = member("ADMIN");

    expect(hasEnterprisePermission(admin, "members.manage_jobs")).toBe(true);
    expect(hasEnterprisePermission(admin, "projects.assign")).toBe(true);
    expect(hasEnterprisePermission(admin, "approvals.read")).toBe(true);
    expect(hasEnterprisePermission(admin, "audit.read")).toBe(true);
    expect(hasEnterprisePermission(admin, "members.manage_admins")).toBe(false);
  });

  it("limits ordinary members to the enterprise overview", () => {
    const ordinaryMember = member("MEMBER");

    expect(enterprisePermissionsForMember(ordinaryMember)).toEqual([
      "enterprise.read",
    ]);
    expect(hasEnterprisePermission(ordinaryMember, "approvals.read")).toBe(false);
    expect(hasEnterprisePermission(ordinaryMember, "audit.read")).toBe(false);
    expect(hasEnterprisePermission(ordinaryMember, "members.manage_jobs")).toBe(false);
  });
});
