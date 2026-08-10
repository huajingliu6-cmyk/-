import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/enterprise/access", () => ({
  requireEnterpriseAccess: vi.fn(),
}));
vi.mock("@/enterprise/store", () => ({
  assignEnterpriseProjects: vi.fn(),
}));
vi.mock("@/projects/project-access", () => ({
  listProjectRecords: vi.fn(),
}));
vi.mock("@/auth/effective-role", () => ({
  listManagedProjectIdsForUser: vi.fn(),
}));

import { PUT } from "@/app/api/enterprises/[enterpriseId]/projects/route";
import { listManagedProjectIdsForUser } from "@/auth/effective-role";
import { requireEnterpriseAccess } from "@/enterprise/access";
import { assignEnterpriseProjects } from "@/enterprise/store";
import { listProjectRecords } from "@/projects/project-access";

const mockedAccess = vi.mocked(requireEnterpriseAccess);
const mockedAssign = vi.mocked(assignEnterpriseProjects);
const mockedManaged = vi.mocked(listManagedProjectIdsForUser);
const mockedProjects = vi.mocked(listProjectRecords);
const context = {
  params: Promise.resolve({ enterpriseId: "enterprise-projects" }),
};

describe("enterprise project scope route", () => {
  beforeEach(() => {
    mockedAccess.mockReset();
    mockedAssign.mockReset();
    mockedManaged.mockReset();
    mockedProjects.mockReset();
    mockedAccess.mockResolvedValue({
      ok: true,
      user: { id: "project-admin" },
      enterprise: {
        id: "enterprise-projects",
        projectIds: ["visible-old", "hidden-existing"],
      },
      member: { enterpriseRole: "ADMIN" },
    } as never);
    mockedProjects.mockResolvedValue([
      { projectId: "visible-old" },
      { projectId: "visible-new" },
      { projectId: "hidden-existing" },
    ] as never);
    mockedManaged.mockResolvedValue(["visible-old", "visible-new"]);
  });

  it("preserves existing projects outside the current manager's scope", async () => {
    mockedAssign.mockResolvedValue({ id: "enterprise-projects" } as never);

    const response = await PUT(
      new Request("http://local/api/projects", {
        method: "PUT",
        body: JSON.stringify({ projectIds: ["visible-new"] }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mockedAssign).toHaveBeenCalledWith({
      enterpriseId: "enterprise-projects",
      projectIds: ["hidden-existing", "visible-new"],
      actorUserId: "project-admin",
    });
  });

  it("rejects project IDs the current manager cannot manage", async () => {
    const response = await PUT(
      new Request("http://local/api/projects", {
        method: "PUT",
        body: JSON.stringify({ projectIds: ["hidden-existing"] }),
      }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mockedAssign).not.toHaveBeenCalled();
  });
});
