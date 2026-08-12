import { beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
}));

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: mocks.requireSessionUser,
}));

import { requireActualProjectOwner } from "@/auth/require-access";
import { resolveEffectiveProjectRole } from "@/auth/effective-role";
import { createEnterprise, assignEnterpriseProjects } from "@/enterprise/store";
import { createProjectRecord } from "@/projects/project-access";
import type { AuthUser } from "@/auth/types";

function auth(id: string, username = id): AuthUser {
  return {
    id,
    username,
    role: "user",
    displayName: username,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("enterprise owner project principal powers", () => {
  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ent-principal-"));
    process.env.APP_DATA_DIR = dir;
    mocks.requireSessionUser.mockReset();
  });

  it("treats enterprise owner as PROJECT_OWNER on attached projects", async () => {
    const owner = auth("ent-owner-1");
    const other = auth("other-owner-1");
    const enterprise = await createEnterprise({
      name: "权限测试企业",
      ownerUserId: owner.id,
    });
    const project = await createProjectRecord(other.id, {
      name: `ent-proj-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    await assignEnterpriseProjects({
      enterpriseId: enterprise.id,
      projectIds: [project.projectId],
      actorUserId: owner.id,
    });

    expect(
      await resolveEffectiveProjectRole(owner.id, project.projectId, owner),
    ).toBe("PROJECT_OWNER");
    expect(
      await resolveEffectiveProjectRole(other.id, project.projectId, other),
    ).toBe("PROJECT_OWNER");

    mocks.requireSessionUser.mockResolvedValue({ ok: true, user: owner });
    const gated = await requireActualProjectOwner(project.projectId);
    expect(gated.ok).toBe(true);
  });

  it("does not grant owner powers for projects outside the enterprise", async () => {
    const owner = auth("ent-owner-2");
    const stranger = auth("stranger-owner-2");
    await createEnterprise({
      name: "范围测试企业",
      ownerUserId: owner.id,
    });
    const project = await createProjectRecord(stranger.id, {
      name: `personal-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });

    expect(
      await resolveEffectiveProjectRole(owner.id, project.projectId, owner),
    ).toBe("NONE");
    mocks.requireSessionUser.mockResolvedValue({ ok: true, user: owner });
    const gated = await requireActualProjectOwner(project.projectId);
    expect(gated.ok).toBe(false);
  });
});
