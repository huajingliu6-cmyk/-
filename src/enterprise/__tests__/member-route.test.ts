import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/enterprise/access", () => ({
  requireEnterpriseAccess: vi.fn(),
}));
vi.mock("@/enterprise/store", () => ({
  updateEnterpriseMember: vi.fn(),
  removeEnterpriseMember: vi.fn(),
}));

import { DELETE, PATCH } from "@/app/api/enterprises/[enterpriseId]/members/[userId]/route";
import { requireEnterpriseAccess } from "@/enterprise/access";
import {
  removeEnterpriseMember,
  updateEnterpriseMember,
} from "@/enterprise/store";

const mockedAccess = vi.mocked(requireEnterpriseAccess);
const mockedUpdate = vi.mocked(updateEnterpriseMember);
const mockedRemove = vi.mocked(removeEnterpriseMember);
const context = {
  params: Promise.resolve({ enterpriseId: "enterprise-member", userId: "target" }),
};

function denied() {
  return {
    ok: false as const,
    response: NextResponse.json({ error: "无权访问该企业" }, { status: 403 }),
  };
}

function allowed() {
  return {
    ok: true as const,
    user: { id: "actor" },
    enterprise: { id: "enterprise-member" },
    member: { enterpriseRole: "ADMIN" },
  } as never;
}

describe("enterprise member route", () => {
  beforeEach(() => {
    mockedAccess.mockReset();
    mockedUpdate.mockReset();
    mockedRemove.mockReset();
  });

  it("rejects ordinary members changing production duties", async () => {
    mockedAccess.mockResolvedValue(denied());

    const response = await PATCH(
      new Request("http://local/api/member", {
        method: "PATCH",
        body: JSON.stringify({ jobRole: "DIRECTOR" }),
      }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("does not let admins grant enterprise administrator status", async () => {
    mockedAccess.mockImplementation(async (_enterpriseId, permission) =>
      permission === "members.manage_admins" ? denied() : allowed(),
    );

    const response = await PATCH(
      new Request("http://local/api/member", {
        method: "PATCH",
        body: JSON.stringify({ enterpriseRole: "ADMIN" }),
      }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("allows authorized managers to remove a non-owner member", async () => {
    mockedAccess.mockResolvedValue(allowed());
    mockedRemove.mockResolvedValue();

    const response = await DELETE(
      new Request("http://local/api/member", { method: "DELETE" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mockedRemove).toHaveBeenCalledWith({
      enterpriseId: "enterprise-member",
      targetUserId: "target",
      actorUserId: "actor",
    });
  });
});
