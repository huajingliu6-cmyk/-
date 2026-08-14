import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  addCardEngineer,
  listMembershipsForUser,
  removeCardEngineer,
} from "@/auth/project-members";
import {
  listAccessibleWorkspaceProjectIds,
  resolveEffectiveProjectRole,
} from "@/auth/effective-role";
import { getSystemRole, workspaceFeaturesForRole } from "@/auth/roles";
import type { AuthUser } from "@/auth/types";
import { createProjectRecord } from "@/projects/project-access";
import { resetInMemoryProjectApi } from "@/projects/__tests__/in-memory-project-api";

vi.mock("@/persistence/remote-data-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/persistence/remote-data-client")>();
  const { requestInMemoryProjectApi } = await import("@/projects/__tests__/in-memory-project-api");
  return { ...actual, requestRemoteData: vi.fn(requestInMemoryProjectApi) };
});
import {
  APP_WORKBENCH_PATH,
  workspaceProjectAssetsPath,
  workspaceProjectPath,
} from "@/shell/nav";

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

describe("effective project roles and workspace routing helpers", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  let tmp: string;

  beforeEach(() => {
    resetInMemoryProjectApi();
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-perm-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("maps admin to SYSTEM_ADMIN", () => {
    expect(getSystemRole(auth("admin", "a1"))).toBe("SYSTEM_ADMIN");
    expect(getSystemRole(auth("user", "u1"))).toBe("USER");
  });

  it("resolves SYSTEM_ADMIN > PROJECT_OWNER > CARD_ENGINEER", async () => {
    const owner = auth("user", "owner-1");
    const engineer = auth("user", "eng-1");
    const admin = auth("admin", "admin-1");
    const project = await createProjectRecord(owner.id, {
      name: `perm-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });

    expect(
      await resolveEffectiveProjectRole(admin.id, project.projectId, admin),
    ).toBe("SYSTEM_ADMIN");
    expect(
      await resolveEffectiveProjectRole(owner.id, project.projectId, owner),
    ).toBe("PROJECT_OWNER");
    expect(
      await resolveEffectiveProjectRole(engineer.id, project.projectId, engineer),
    ).toBe("NONE");

    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    expect(
      await resolveEffectiveProjectRole(engineer.id, project.projectId, engineer),
    ).toBe("CARD_ENGINEER");
    expect(workspaceFeaturesForRole("CARD_ENGINEER")).toEqual([
      "assets",
      "storyboard",
    ]);
    expect(workspaceFeaturesForRole("PROJECT_OWNER")).toContain("storyboard");
    expect(workspaceFeaturesForRole("CARD_ENGINEER")).not.toContain("video");
  });

  it("workspace list only includes assigned projects for card engineers", async () => {
    const owner = auth("user", "owner-2");
    const engineer = auth("user", "eng-2");
    const p1 = await createProjectRecord(owner.id, {
      name: `a-${Date.now()}`,
      creationSource: "story",
      projectMode: "canvas",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const p2 = await createProjectRecord(owner.id, {
      name: `b-${Date.now()}`,
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: p1.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });

    const ids = await listAccessibleWorkspaceProjectIds(engineer);
    expect(ids).toContain(p1.projectId);
    expect(ids).not.toContain(p2.projectId);

    await removeCardEngineer(p1.projectId, engineer.id);
    expect(await listMembershipsForUser(engineer.id)).toHaveLength(0);
    expect(await listAccessibleWorkspaceProjectIds(engineer)).toEqual([]);
  });

  it("workspace project paths stay under /app/workspace", () => {
    expect(workspaceProjectPath("p1")).toBe(
      `${APP_WORKBENCH_PATH}/projects/p1`,
    );
    expect(workspaceProjectAssetsPath("p1")).toBe(
      `${APP_WORKBENCH_PATH}/projects/p1/assets`,
    );
    expect(workspaceProjectPath("p1")).not.toContain("/app/projects/p1");
  });
});
