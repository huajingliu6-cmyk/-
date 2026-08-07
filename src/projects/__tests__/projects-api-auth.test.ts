import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { AuthUser } from "@/auth/types";

const adminUser: AuthUser = {
  id: "admin-session-1",
  username: "admin",
  role: "admin",
  displayName: "Admin",
  createdAt: "t",
  updatedAt: "t",
};

const memberUser: AuthUser = {
  id: "member-session-1",
  username: "member",
  role: "user",
  displayName: "Member",
  createdAt: "t",
  updatedAt: "t",
};

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

vi.mock("@/projects/project-access", async () => {
  const actual = await vi.importActual<typeof import("@/projects/project-access")>(
    "@/projects/project-access",
  );
  return {
    ...actual,
    listProjectListItems: vi.fn(),
    createProjectRecord: vi.fn(),
  };
});

vi.mock("@/persistence/config", async () => {
  const actual = await vi.importActual<typeof import("@/persistence/config")>(
    "@/persistence/config",
  );
  return {
    ...actual,
    getPersistenceDriver: vi.fn(() => "file"),
  };
});

import { requireSessionUser } from "@/auth/require-user";
import { getPersistenceDriver } from "@/persistence/config";
import {
  createProjectRecord,
  listProjectListItems,
} from "@/projects/project-access";
import { GET, POST } from "@/app/api/projects/route";

describe("GET/POST /api/projects auth gates", () => {
  beforeEach(() => {
    vi.mocked(requireSessionUser).mockReset();
    vi.mocked(listProjectListItems).mockReset();
    vi.mocked(createProjectRecord).mockReset();
    vi.mocked(getPersistenceDriver).mockReturnValue("file");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated list", async () => {
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    });
    const res = await GET(new Request("http://localhost/api/projects"));
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated create", async () => {
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    });
    const res = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: "x",
          creationSource: "story",
          projectMode: "canvas",
          passwordEnabled: false,
        }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects non-principal create", async () => {
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: memberUser,
    });
    const res = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "x",
          creationSource: "story",
          projectMode: "canvas",
          passwordEnabled: false,
        }),
      }),
    );
    expect(res.status).toBe(403);
    expect(createProjectRecord).not.toHaveBeenCalled();
  });

  it("rejects client-supplied ownerId", async () => {
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: adminUser,
    });
    const res = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "合法名称",
          creationSource: "story",
          projectMode: "canvas",
          passwordEnabled: false,
          ownerId: "forged-owner",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(createProjectRecord).not.toHaveBeenCalled();
  });

  it("creates with session user id as owner", async () => {
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: adminUser,
    });
    vi.mocked(createProjectRecord).mockResolvedValue({
      projectId: "p_1",
      rootFolderId: "p_1",
      name: "合法名称",
      ownerId: adminUser.id,
      creationSource: "story",
      projectMode: "canvas",
      status: "draft",
      highlights: "",
      passwordEnabled: false,
      createdAt: "t",
      updatedAt: "t",
    });
    const res = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "合法名称",
          creationSource: "story",
          projectMode: "canvas",
          passwordEnabled: false,
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect(createProjectRecord).toHaveBeenCalledWith(
      adminUser.id,
      expect.objectContaining({ name: "合法名称" }),
    );
  });

  it("lists projects for authenticated user", async () => {
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: adminUser,
    });
    vi.mocked(listProjectListItems).mockResolvedValue({ projects: [] });
    const res = await GET(new Request("http://localhost/api/projects?page=1&pageSize=50"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projects: unknown[];
      canCreateProject: boolean;
      total?: number;
      page?: number;
      pageSize?: number;
    };
    expect(body.projects).toEqual([]);
    expect(body.canCreateProject).toBe(true);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
  });
});
