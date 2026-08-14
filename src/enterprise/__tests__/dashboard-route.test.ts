import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Enterprise } from "@/enterprise/types";

vi.mock("@/enterprise/access", () => ({
  requireEnterpriseAccess: vi.fn(),
}));
vi.mock("@/enterprise/dashboard", () => ({
  enterpriseDashboard: vi.fn(),
}));

import { GET } from "@/app/api/enterprises/[enterpriseId]/route";
import { requireEnterpriseAccess } from "@/enterprise/access";
import { enterpriseDashboard } from "@/enterprise/dashboard";

const mockedAccess = vi.mocked(requireEnterpriseAccess);
const mockedDashboard = vi.mocked(enterpriseDashboard);

const enterprise: Enterprise = {
  id: "enterprise-dashboard",
  accountId: "ENT-12345678",
  name: "看板企业",
  ownerUserId: "owner",
  members: [],
  projectIds: [],
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

describe("enterprise dashboard route", () => {
  beforeEach(() => {
    mockedAccess.mockReset();
    mockedDashboard.mockReset();
    mockedDashboard.mockResolvedValue({
      enterprise: { id: enterprise.id, accountId: enterprise.accountId, name: enterprise.name, projectIds: [] },
      members: [],
      projects: [],
      joinRequests: [],
      approvals: [],
      auditEvents: [],
      stats: {
        memberCount: 0,
        projectCount: 0,
        pendingJoinRequestCount: 0,
        pendingApprovalCount: 0,
        spentCredits: 0,
        creditBalance: 10_000,
        frozenCredits: 0,
      },
    });
  });

  it("does not load restricted data for ordinary members", async () => {
    mockedAccess.mockResolvedValue({
      ok: true,
      user: { id: "member" } as never,
      enterprise,
      member: {
        userId: "member",
        enterpriseRole: "MEMBER",
        jobRole: "WRITER",
        joinedAt: "2026-08-10T00:00:00.000Z",
        invitedByUserId: null,
      },
    });

    const response = await GET(new Request("http://local/api/enterprises/enterprise-dashboard"), {
      params: Promise.resolve({ enterpriseId: enterprise.id }),
    });

    expect(response.status).toBe(200);
    expect(mockedDashboard).toHaveBeenCalledWith(enterprise, {
      approvals: false,
      audit: false,
      joinRequests: false,
    });
    expect((await response.json()).permissions).toEqual({
      canAssignProjects: false,
      canAudit: false,
      canManageAdmins: false,
      canManageJobs: false,
      canReadApprovals: false,
      canRemoveMembers: false,
      canReviewRequests: false,
    });
  });
});
