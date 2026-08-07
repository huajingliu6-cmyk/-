import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import type { AuthUser } from "@/auth/types";
import { addCardEngineer, removeCardEngineer } from "@/auth/project-members";
import { createProjectRecord } from "@/projects/project-access";
import { resetInMemoryProjectApi } from "@/projects/__tests__/in-memory-project-api";

vi.mock("@/persistence/remote-data-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/persistence/remote-data-client")>();
  const { requestInMemoryProjectApi } = await import("@/projects/__tests__/in-memory-project-api");
  return { ...actual, requestRemoteData: vi.fn(requestInMemoryProjectApi) };
});

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import {
  requireActualProjectOwner,
  requireProjectManagementAccess,
  requireProjectManagementProjectAccess,
  requireStoryboardAccess,
  requireVideoCanvasAccess,
  requireWorkspaceAssetAccess,
  requireWorkspaceProjectAccess,
} from "@/auth/require-access";
import { GET as getWorkspaceProjects } from "@/app/api/workspace/projects/route";
import { GET as getProjects } from "@/app/api/projects/route";
import {
  GET as getAssetsDraft,
  PUT as putAssetsDraft,
} from "@/app/api/projects/[projectId]/assets-draft/route";

function auth(
  role: AuthUser["role"],
  id: string,
  username = id,
): AuthUser {
  return {
    id,
    username,
    role,
    displayName: username,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("require-access and workspace API gates", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  let tmp: string;

  beforeEach(() => {
    resetInMemoryProjectApi();
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-access-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    rmSync(tmp, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("card engineer can access assigned workspace assets and storyboard but not management or video", async () => {
    const owner = auth("user", "owner-a");
    const engineer = auth("user", "eng-a");
    const project = await createProjectRecord(owner.id, {
      name: `access-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });

    expect((await requireWorkspaceProjectAccess(project.projectId)).ok).toBe(
      true,
    );
    expect((await requireWorkspaceAssetAccess(project.projectId)).ok).toBe(
      true,
    );
    expect((await requireStoryboardAccess(project.projectId)).ok).toBe(true);
    expect((await requireVideoCanvasAccess(project.projectId)).ok).toBe(false);
    expect(
      (await requireProjectManagementProjectAccess(project.projectId)).ok,
    ).toBe(false);
    expect((await requireProjectManagementAccess()).ok).toBe(false);

    const list = await getWorkspaceProjects();
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      projects: Array<{ projectId: string }>;
    };
    expect(body.projects.map((p) => p.projectId)).toEqual([project.projectId]);

    const managementList = await getProjects(
      new Request("http://localhost/api/projects"),
    );
    expect(managementList.status).toBe(403);
  });

  it("removed card engineer loses asset access with 403", async () => {
    const owner = auth("user", "owner-b");
    const engineer = auth("user", "eng-b");
    const project = await createProjectRecord(owner.id, {
      name: `revoked-${Date.now()}`,
      creationSource: "story",
      projectMode: "canvas",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    await removeCardEngineer(project.projectId, engineer.id);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });

    const gated = await requireWorkspaceAssetAccess(project.projectId);
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.response.status).toBe(403);

    const getRes = await getAssetsDraft(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.projectId }),
    });
    expect(getRes.status).toBe(403);

    const putRes = await putAssetsDraft(
      new Request("http://localhost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characters: [],
          scenes: [],
          props: [],
          audios: [],
          ownerId: owner.id,
          systemRole: "SYSTEM_ADMIN",
        }),
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(putRes.status).toBe(403);
  });

  it("rejects forged permission fields on management asset save for owner", async () => {
    const owner = auth("user", "owner-c");
    const project = await createProjectRecord(owner.id, {
      name: `forge-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });

    const putRes = await putAssetsDraft(
      new Request("http://localhost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characters: [],
          scenes: [],
          props: [],
          audios: [],
          ownerId: "forged",
          isAdmin: true,
        }),
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(putRes.status).toBe(400);
  });

  it("management assets-draft denies CARD_ENGINEER and non-owner SYSTEM_ADMIN", async () => {
    const owner = auth("user", "owner-c2");
    const engineer = auth("user", "eng-c2");
    const admin = auth("admin", "admin-c2");
    const project = await createProjectRecord(owner.id, {
      name: `mgmt-assets-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });
    const ceGet = await getAssetsDraft(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.projectId }),
    });
    expect(ceGet.status).toBe(403);

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: admin,
    });
    const adminGet = await getAssetsDraft(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.projectId }),
    });
    expect(adminGet.status).toBe(403);
  });

  it("project owner manages own project; other owner project is 403", async () => {
    const owner1 = auth("user", "owner-d1");
    const owner2 = auth("user", "owner-d2");
    const p1 = await createProjectRecord(owner1.id, {
      name: `own-${Date.now()}`,
      creationSource: "story",
      projectMode: "canvas",
      passwordEnabled: false,
    });
    const p2 = await createProjectRecord(owner2.id, {
      name: `other-${Date.now()}`,
      creationSource: "story",
      projectMode: "canvas",
      passwordEnabled: false,
    });

    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner1,
    });
    expect((await requireProjectManagementProjectAccess(p1.projectId)).ok).toBe(
      true,
    );
    expect((await requireProjectManagementProjectAccess(p2.projectId)).ok).toBe(
      false,
    );
    expect((await requireVideoCanvasAccess(p1.projectId)).ok).toBe(true);
  });

  it("system admin who is not owner cannot manage others' projects", async () => {
    const owner = auth("user", "owner-e");
    const admin = auth("admin", "admin-e");
    const project = await createProjectRecord(owner.id, {
      name: `admin-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: admin,
    });
    expect((await requireProjectManagementAccess()).ok).toBe(true);

    const gated = await requireProjectManagementProjectAccess(project.projectId);
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.response.status).toBe(403);
      const body = (await gated.response.json()) as { error?: string };
      expect(body.error).toBe("仅项目主理人可操作");
    }
    expect((await requireActualProjectOwner(project.projectId)).ok).toBe(false);
    expect((await requireVideoCanvasAccess(project.projectId)).ok).toBe(true);

    const list = await getWorkspaceProjects();
    const body = (await list.json()) as {
      projects: Array<{ projectId: string }>;
    };
    expect(body.projects.map((p) => p.projectId)).toContain(project.projectId);
  });

  it("system admin who owns the project can manage it", async () => {
    const admin = auth("admin", "admin-owner-e");
    const project = await createProjectRecord(admin.id, {
      name: `admin-own-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: admin,
    });
    expect(
      (await requireProjectManagementProjectAccess(project.projectId)).ok,
    ).toBe(true);
    expect((await requireActualProjectOwner(project.projectId)).ok).toBe(true);
  });

  it("forged body role fields do not bypass owner gate on asset save", async () => {
    const owner = auth("user", "owner-forge-gate");
    const engineer = auth("user", "eng-forge-gate");
    const project = await createProjectRecord(owner.id, {
      name: `forge-gate-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });

    // Management assets-draft is owner-only; CE keeps workspace asset access only.
    expect((await requireProjectManagementProjectAccess(project.projectId)).ok).toBe(
      false,
    );
    expect((await requireWorkspaceAssetAccess(project.projectId)).ok).toBe(true);

    const putRes = await putAssetsDraft(
      new Request("http://localhost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characters: [],
          scenes: [],
          props: [],
          audios: [],
          ownerId: owner.id,
          systemRole: "SYSTEM_ADMIN",
        }),
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(putRes.status).toBe(403);
  });

  it("unauthenticated access returns 401", async () => {
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    });
    const gated = await requireWorkspaceProjectAccess("any");
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.response.status).toBe(401);
  });
});
