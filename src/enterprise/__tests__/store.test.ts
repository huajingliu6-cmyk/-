import { describe, expect, it } from "vitest";
import {
  assignEnterpriseProjects,
  createEnterprise,
  decideEnterpriseJoinRequest,
  enterpriseSpaceOverviewForUser,
  findEnterpriseByAccountId,
  getEnterprise,
  listEnterpriseAuditEvents,
  removeEnterpriseMember,
  dissolveEnterprise,
  inviteEnterpriseMember,
  leaveEnterprise,
  submitEnterpriseJoinRequest,
  transferEnterpriseOwnership,
  updateEnterpriseMember,
} from "@/enterprise/store";

describe("enterprise store", () => {
  it("creates an enterprise searchable only by its complete account ID", async () => {
    const enterprise = await createEnterprise({
      name: "星河动画",
      ownerUserId: "owner-search",
    });

    expect(await findEnterpriseByAccountId(enterprise.accountId.toLowerCase())).toEqual({
      id: enterprise.id,
      accountId: enterprise.accountId,
      name: "星河动画",
    });
    expect(await findEnterpriseByAccountId(enterprise.accountId.slice(0, -1))).toBeNull();
    expect(enterprise.members[0]).toMatchObject({
      userId: "owner-search",
      enterpriseRole: "OWNER",
      jobRole: "PRODUCER",
    });
  });

  it("keeps pending join requests idempotent and adds approved members", async () => {
    const enterprise = await createEnterprise({
      name: "光影工场",
      ownerUserId: "owner-join",
    });
    const first = await submitEnterpriseJoinRequest({
      enterpriseId: enterprise.id,
      applicantUserId: "applicant-join",
      message: "希望加入项目",
    });
    const repeated = await submitEnterpriseJoinRequest({
      enterpriseId: enterprise.id,
      applicantUserId: "applicant-join",
      message: "重复提交",
    });

    expect(repeated.id).toBe(first.id);

    await decideEnterpriseJoinRequest({
      enterpriseId: enterprise.id,
      requestId: first.id,
      actorUserId: "owner-join",
      decision: "APPROVED",
    });

    const updated = await getEnterprise(enterprise.id);
    expect(updated?.members).toContainEqual(
      expect.objectContaining({
        userId: "applicant-join",
        enterpriseRole: "MEMBER",
        jobRole: "CARD_ENGINEER",
      }),
    );
    await expect(
      submitEnterpriseJoinRequest({
        enterpriseId: enterprise.id,
        applicantUserId: "applicant-join",
      }),
    ).rejects.toThrow("你已经是该企业成员");
  });

  it("loads joined enterprises and pending applications from one overview", async () => {
    const joined = await createEnterprise({
      name: "已加入企业",
      ownerUserId: "overview-user",
    });
    const pending = await createEnterprise({
      name: "待审核企业",
      ownerUserId: "overview-owner",
    });
    await submitEnterpriseJoinRequest({
      enterpriseId: pending.id,
      applicantUserId: "overview-user",
    });

    const overview = await enterpriseSpaceOverviewForUser("overview-user");

    expect(overview.enterprises.map((enterprise) => enterprise.id)).toContain(joined.id);
    expect(overview.pendingJoinRequests).toEqual([
      expect.objectContaining({
        enterprise: expect.objectContaining({ id: pending.id }),
        request: expect.objectContaining({ applicantUserId: "overview-user" }),
      }),
    ]);
  });

  it("updates member duties and roles while protecting the owner", async () => {
    const enterprise = await createEnterprise({
      name: "帧界制作",
      ownerUserId: "owner-member",
    });
    const request = await submitEnterpriseJoinRequest({
      enterpriseId: enterprise.id,
      applicantUserId: "member-update",
    });
    await decideEnterpriseJoinRequest({
      enterpriseId: enterprise.id,
      requestId: request.id,
      actorUserId: "owner-member",
      decision: "APPROVED",
    });

    await updateEnterpriseMember({
      enterpriseId: enterprise.id,
      targetUserId: "member-update",
      actorUserId: "owner-member",
      jobRole: "DIRECTOR",
      enterpriseRole: "ADMIN",
    });
    expect(
      (await getEnterprise(enterprise.id))?.members.find(
        (item) => item.userId === "member-update",
      ),
    ).toMatchObject({ jobRole: "DIRECTOR", enterpriseRole: "ADMIN" });

    await expect(
      updateEnterpriseMember({
        enterpriseId: enterprise.id,
        targetUserId: "owner-member",
        actorUserId: "owner-member",
        jobRole: "WRITER",
      }),
    ).rejects.toThrow("不能修改企业所有者");
    await expect(
      removeEnterpriseMember({
        enterpriseId: enterprise.id,
        targetUserId: "owner-member",
        actorUserId: "owner-member",
      }),
    ).rejects.toThrow("不能移除企业所有者");
    await expect(
      removeEnterpriseMember({
        enterpriseId: enterprise.id,
        targetUserId: "member-update",
        actorUserId: "member-update",
      }),
    ).rejects.toThrow("不能通过成员管理移除自己");
  });

  it("deduplicates project scope and records organization audit events", async () => {
    const enterprise = await createEnterprise({
      name: "镜头实验室",
      ownerUserId: "owner-audit",
    });

    await assignEnterpriseProjects({
      enterpriseId: enterprise.id,
      projectIds: ["project-a", "project-a", " project-b "],
      actorUserId: "owner-audit",
    });

    expect((await getEnterprise(enterprise.id))?.projectIds).toEqual([
      "project-a",
      "project-b",
    ]);
    expect(await listEnterpriseAuditEvents(enterprise.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ENTERPRISE_CREATED" }),
        expect.objectContaining({ type: "PROJECTS_ASSIGNED" }),
      ]),
    );
  });

  it("prevents a project from belonging to two enterprises", async () => {
    const first = await createEnterprise({ name: "第一企业", ownerUserId: "first-owner" });
    const second = await createEnterprise({ name: "第二企业", ownerUserId: "second-owner" });
    await assignEnterpriseProjects({
      enterpriseId: first.id,
      projectIds: ["exclusive-project"],
      actorUserId: "first-owner",
    });

    await expect(
      assignEnterpriseProjects({
        enterpriseId: second.id,
        projectIds: ["exclusive-project"],
        actorUserId: "second-owner",
      }),
    ).rejects.toThrow("项目已归属企业");
  });

  it("supports invite, leave, ownership transfer and dissolution", async () => {
    const enterprise = await createEnterprise({
      name: "生命周期企业",
      ownerUserId: "lifecycle-owner",
    });
    await inviteEnterpriseMember({
      enterpriseId: enterprise.id,
      targetUserId: "lifecycle-member",
      actorUserId: "lifecycle-owner",
      jobRole: "DIRECTOR",
    });
    await expect(
      leaveEnterprise({ enterpriseId: enterprise.id, userId: "lifecycle-owner" }),
    ).rejects.toThrow("需先转让所有权或解散企业");

    const transferred = await transferEnterpriseOwnership({
      enterpriseId: enterprise.id,
      ownerUserId: "lifecycle-owner",
      targetUserId: "lifecycle-member",
    });
    expect(transferred.ownerUserId).toBe("lifecycle-member");
    expect(transferred.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "lifecycle-owner", enterpriseRole: "ADMIN" }),
        expect.objectContaining({ userId: "lifecycle-member", enterpriseRole: "OWNER" }),
      ]),
    );

    await leaveEnterprise({ enterpriseId: enterprise.id, userId: "lifecycle-owner" });
    expect((await getEnterprise(enterprise.id))?.members.map((member) => member.userId)).toEqual([
      "lifecycle-member",
    ]);
    await dissolveEnterprise({ enterpriseId: enterprise.id, ownerUserId: "lifecycle-member" });
    expect(await getEnterprise(enterprise.id)).toBeNull();
  });
});
