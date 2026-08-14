import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/enterprise/access", () => ({
  requireEnterpriseAccess: vi.fn(),
}));
vi.mock("@/enterprise/store", () => ({
  decideEnterpriseJoinRequest: vi.fn(),
  listEnterpriseJoinRequests: vi.fn(),
}));
vi.mock("@/notifications/store", () => ({
  createNotification: vi.fn(),
}));
vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { PATCH } from "@/app/api/enterprises/[enterpriseId]/join-requests/route";
import { requireEnterpriseAccess } from "@/enterprise/access";
import { decideEnterpriseJoinRequest } from "@/enterprise/store";
import { createNotification } from "@/notifications/store";

const mockedAccess = vi.mocked(requireEnterpriseAccess);
const mockedDecision = vi.mocked(decideEnterpriseJoinRequest);
const mockedNotification = vi.mocked(createNotification);
const context = {
  params: Promise.resolve({ enterpriseId: "enterprise-join-route" }),
};

describe("enterprise join decision route", () => {
  beforeEach(() => {
    mockedAccess.mockReset();
    mockedDecision.mockReset();
    mockedNotification.mockReset();
    mockedAccess.mockResolvedValue({
      ok: true,
      user: { id: "owner" },
      enterprise: { id: "enterprise-join-route", name: "云帧制作" },
      member: { enterpriseRole: "OWNER" },
    } as never);
    mockedDecision.mockResolvedValue({
      id: "join-request-1",
      enterpriseId: "enterprise-join-route",
      applicantUserId: "applicant",
      status: "APPROVED",
      message: "",
      createdAt: "2026-08-10T00:00:00.000Z",
      decidedAt: "2026-08-10T01:00:00.000Z",
      decidedByUserId: "owner",
    });
  });

  it("creates an approved notification for the applicant", async () => {
    const response = await PATCH(
      new Request("http://local/api/join-requests", {
        method: "PATCH",
        body: JSON.stringify({ requestId: "join-request-1", decision: "APPROVED" }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mockedNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: "applicant",
        type: "enterprise_join_approved",
        enterpriseId: "enterprise-join-route",
        submissionId: "join-request-1",
        dedupeBySubmissionId: true,
      }),
    );
  });

  it("does not roll back a completed decision when notification delivery fails", async () => {
    mockedNotification.mockRejectedValue(new Error("notification unavailable"));

    const response = await PATCH(
      new Request("http://local/api/join-requests", {
        method: "PATCH",
        body: JSON.stringify({ requestId: "join-request-1", decision: "REJECTED" }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mockedNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "enterprise_join_rejected" }),
    );
  });
});
