import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/enterprise/access", () => ({ requireEnterpriseAccess: vi.fn() }));
vi.mock("@/enterprise/store", () => ({
  dissolveEnterprise: vi.fn(),
  leaveEnterprise: vi.fn(),
  transferEnterpriseOwnership: vi.fn(),
}));

import { POST } from "@/app/api/enterprises/[enterpriseId]/lifecycle/route";
import { requireEnterpriseAccess } from "@/enterprise/access";
import {
  dissolveEnterprise,
  leaveEnterprise,
  transferEnterpriseOwnership,
} from "@/enterprise/store";

const context = { params: Promise.resolve({ enterpriseId: "enterprise-lifecycle" }) };
const mockedAccess = vi.mocked(requireEnterpriseAccess);

describe("enterprise lifecycle route", () => {
  beforeEach(() => {
    vi.mocked(dissolveEnterprise).mockReset();
    vi.mocked(leaveEnterprise).mockReset();
    vi.mocked(transferEnterpriseOwnership).mockReset();
    mockedAccess.mockReset();
    mockedAccess.mockResolvedValue({
      ok: true,
      user: { id: "owner" },
      enterprise: { id: "enterprise-lifecycle" },
      member: { enterpriseRole: "OWNER" },
    } as never);
  });

  it("lets the current member leave", async () => {
    const response = await POST(new Request("http://local/lifecycle", {
      method: "POST", body: JSON.stringify({ action: "leave" }),
    }), context);

    expect(response.status).toBe(200);
    expect(leaveEnterprise).toHaveBeenCalledWith({
      enterpriseId: "enterprise-lifecycle", userId: "owner",
    });
  });

  it("forwards ownership transfer to the store", async () => {
    vi.mocked(transferEnterpriseOwnership).mockResolvedValue({ id: "enterprise-lifecycle" } as never);
    const response = await POST(new Request("http://local/lifecycle", {
      method: "POST", body: JSON.stringify({ action: "transfer", targetUserId: "next-owner" }),
    }), context);

    expect(response.status).toBe(200);
    expect(transferEnterpriseOwnership).toHaveBeenCalledWith({
      enterpriseId: "enterprise-lifecycle", ownerUserId: "owner", targetUserId: "next-owner",
    });
  });

  it("rejects transfer without a target user", async () => {
    const response = await POST(new Request("http://local/lifecycle", {
      method: "POST", body: JSON.stringify({ action: "transfer" }),
    }), context);

    expect(response.status).toBe(400);
    expect(transferEnterpriseOwnership).not.toHaveBeenCalled();
  });

  it("dissolves through the current owner", async () => {
    const response = await POST(new Request("http://local/lifecycle", {
      method: "POST", body: JSON.stringify({ action: "dissolve" }),
    }), context);

    expect(response.status).toBe(200);
    expect(dissolveEnterprise).toHaveBeenCalledWith({
      enterpriseId: "enterprise-lifecycle", ownerUserId: "owner",
    });
  });

  it("passes through denied enterprise access", async () => {
    mockedAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "denied" }, { status: 403 }),
    });
    const response = await POST(new Request("http://local/lifecycle", {
      method: "POST", body: JSON.stringify({ action: "leave" }),
    }), context);
    expect(response.status).toBe(403);
    expect(leaveEnterprise).not.toHaveBeenCalled();
  });
});
