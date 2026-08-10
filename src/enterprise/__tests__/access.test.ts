import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/auth/types";
import type { Enterprise, EnterpriseMemberRole } from "@/enterprise/types";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));
vi.mock("@/enterprise/store", () => ({
  getEnterprise: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import { requireEnterpriseAccess } from "@/enterprise/access";
import { getEnterprise } from "@/enterprise/store";

const mockedSession = vi.mocked(requireSessionUser);
const mockedEnterprise = vi.mocked(getEnterprise);

function user(id: string): AuthUser {
  return {
    id,
    username: id,
    displayName: id,
    role: "user",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

function enterprise(userId: string, enterpriseRole: EnterpriseMemberRole): Enterprise {
  return {
    id: "enterprise-access",
    accountId: "ENT-12345678",
    name: "权限测试企业",
    ownerUserId: "owner-access",
    members: [{
      userId,
      enterpriseRole,
      jobRole: "PRODUCER",
      joinedAt: "2026-08-10T00:00:00.000Z",
      invitedByUserId: null,
    }],
    projectIds: [],
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

describe("enterprise access boundary", () => {
  beforeEach(() => {
    mockedSession.mockReset();
    mockedEnterprise.mockReset();
  });

  it("rejects authenticated users who are not enterprise members", async () => {
    mockedSession.mockResolvedValue({ ok: true, user: user("outsider") });
    mockedEnterprise.mockResolvedValue(enterprise("member", "MEMBER"));

    const result = await requireEnterpriseAccess("enterprise-access");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("maps dedicated enterprise service failures to 503", async () => {
    mockedSession.mockResolvedValue({ ok: true, user: user("member") });
    mockedEnterprise.mockRejectedValue(
      new Error("REMOTE_ENTERPRISE_READ_FAILED:500"),
    );

    const result = await requireEnterpriseAccess("enterprise-access");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  });

  it("does not grant ordinary members access to approvals or audit logs", async () => {
    mockedSession.mockResolvedValue({ ok: true, user: user("member") });
    mockedEnterprise.mockResolvedValue(enterprise("member", "MEMBER"));

    const approvals = await requireEnterpriseAccess(
      "enterprise-access",
      "approvals.read",
    );
    const audit = await requireEnterpriseAccess("enterprise-access", "audit.read");
    const memberUpdates = await requireEnterpriseAccess(
      "enterprise-access",
      "members.manage_jobs",
    );

    expect(approvals.ok).toBe(false);
    expect(audit.ok).toBe(false);
    expect(memberUpdates.ok).toBe(false);
  });

  it("lets admins manage duties but not grant administrator status", async () => {
    mockedSession.mockResolvedValue({ ok: true, user: user("admin") });
    mockedEnterprise.mockResolvedValue(enterprise("admin", "ADMIN"));

    expect(
      (await requireEnterpriseAccess("enterprise-access", "members.manage_jobs")).ok,
    ).toBe(true);
    expect(
      (await requireEnterpriseAccess("enterprise-access", "members.manage_admins")).ok,
    ).toBe(false);
  });
});
