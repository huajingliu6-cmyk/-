import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/enterprise/access", () => ({ requireEnterpriseAccess: vi.fn() }));
vi.mock("@/enterprise/store", () => ({ inviteEnterpriseMember: vi.fn() }));
vi.mock("@/auth/users", () => ({ findUserByUsername: vi.fn() }));

import { POST } from "@/app/api/enterprises/[enterpriseId]/members/route";
import { requireEnterpriseAccess } from "@/enterprise/access";
import { inviteEnterpriseMember } from "@/enterprise/store";
import { findUserByUsername } from "@/auth/users";

const context = { params: Promise.resolve({ enterpriseId: "enterprise-invite" }) };

describe("enterprise direct invite route", () => {
  beforeEach(() => {
    vi.mocked(requireEnterpriseAccess).mockReset();
    vi.mocked(inviteEnterpriseMember).mockReset();
    vi.mocked(findUserByUsername).mockReset();
    vi.mocked(requireEnterpriseAccess).mockResolvedValue({
      ok: true,
      user: { id: "admin" },
      enterprise: { id: "enterprise-invite" },
      member: { enterpriseRole: "ADMIN" },
    } as never);
  });

  it("invites an exact matched user with the selected job role", async () => {
    vi.mocked(findUserByUsername).mockResolvedValue({ id: "writer" } as never);
    vi.mocked(inviteEnterpriseMember).mockResolvedValue({ userId: "writer" } as never);
    const response = await POST(new Request("http://local/members", {
      method: "POST", body: JSON.stringify({ username: "writer_name", jobRole: "WRITER" }),
    }), context);

    expect(response.status).toBe(201);
    expect(findUserByUsername).toHaveBeenCalledWith("writer_name");
    expect(inviteEnterpriseMember).toHaveBeenCalledWith({
      enterpriseId: "enterprise-invite", targetUserId: "writer", actorUserId: "admin", jobRole: "WRITER",
    });
  });

  it("does not reveal a member list when the username does not exactly match", async () => {
    vi.mocked(findUserByUsername).mockResolvedValue(null);
    const response = await POST(new Request("http://local/members", {
      method: "POST", body: JSON.stringify({ username: "partial", jobRole: "WRITER" }),
    }), context);

    expect(response.status).toBe(404);
    expect(inviteEnterpriseMember).not.toHaveBeenCalled();
  });

  it("requires member-management permission", async () => {
    vi.mocked(requireEnterpriseAccess).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "denied" }, { status: 403 }),
    });
    const response = await POST(new Request("http://local/members", {
      method: "POST", body: JSON.stringify({ username: "writer_name", jobRole: "WRITER" }),
    }), context);

    expect(response.status).toBe(403);
    expect(findUserByUsername).not.toHaveBeenCalled();
  });
});
