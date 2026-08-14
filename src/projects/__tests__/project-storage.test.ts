import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "@/auth/password";
import {
  createProjectRecord,
  getProjectPublic,
  getProjectRecord,
  ProjectNameConflictError,
  updateProjectHighlights,
} from "@/projects/project-storage";
import { canEditProjectHighlights } from "@/auth/capabilities";
import type { AuthUser } from "@/auth/types";

describe("project storage + password safety", () => {
  let tmp: string;
  let previousAppDataDir: string | undefined;

  beforeEach(async () => {
    previousAppDataDir = process.env.APP_DATA_DIR;
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "proj-meta-"));
    process.env.APP_DATA_DIR = tmp;
  });

  afterEach(async () => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("创建项目并安全哈希密码，公开视图不含 hash", async () => {
    const publicProject = await createProjectRecord("owner-1", {
      name: "雨夜追光",
      creationSource: "story",
      projectMode: "canvas",
      highlights: "赛博雨夜",
      passwordEnabled: true,
      projectPassword: "access-secret",
    });

    expect(publicProject.name).toBe("雨夜追光");
    expect(publicProject.ownerId).toBe("owner-1");
    expect(publicProject.rootFolderId).toBe(publicProject.projectId);
    expect(publicProject.status).toBe("draft");
    expect(publicProject.passwordEnabled).toBe(true);
    expect("passwordHash" in publicProject).toBe(false);

    const record = await getProjectRecord(publicProject.projectId);
    expect(record).not.toBeNull();
    expect(record!.passwordHash).toBeTruthy();
    expect(record!.passwordSalt).toBeTruthy();
    expect(verifyPassword("access-secret", record!.passwordHash!, record!.passwordSalt!)).toBe(
      true,
    );

    const exposed = await getProjectPublic(publicProject.projectId);
    expect(exposed).toMatchObject({ name: "雨夜追光", passwordEnabled: true });
    expect(JSON.stringify(exposed)).not.toContain(record!.passwordHash);
  });

  it("未启用密码时不存储 hash", async () => {
    const project = await createProjectRecord("owner-1", {
      name: "无密项目",
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
      projectPassword: null,
    });
    const record = await getProjectRecord(project.projectId);
    expect(record!.passwordHash).toBeNull();
    expect(record!.passwordSalt).toBeNull();
  });

  it("allows the same project name for different owners", async () => {
    await createProjectRecord("owner-1", {
      name: "同名",
      creationSource: "story",
      projectMode: "canvas",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    await expect(
      createProjectRecord("owner-2", {
        name: "同名",
        creationSource: "story",
        projectMode: "canvas",
        visualStyle: "live_action_cinematic",
      passwordEnabled: false,
      }),
    ).resolves.toMatchObject({ ownerId: "owner-2", name: "同名" });
  });

  it("rejects duplicate project names for the same owner", async () => {
    await createProjectRecord("owner-1", {
      name: "同一账号重名",
      creationSource: "story",
      projectMode: "canvas",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    await expect(
      createProjectRecord("owner-1", {
        name: "同一账号重名",
        creationSource: "story",
        projectMode: "canvas",
        visualStyle: "live_action_cinematic",
      passwordEnabled: false,
      }),
    ).rejects.toBeInstanceOf(ProjectNameConflictError);
  });

  it("项目要点更新接口权限：非主理人拒绝", async () => {
    const project = await createProjectRecord("owner-1", {
      name: "要点项目",
      creationSource: "story",
      projectMode: "canvas",
      highlights: "旧",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });

    const owner: AuthUser = {
      id: "owner-1",
      username: "admin",
      role: "admin",
      displayName: "Admin",
      createdAt: "t",
      updatedAt: "t",
    };
    const stranger: AuthUser = {
      id: "other",
      username: "u",
      role: "user",
      displayName: "U",
      createdAt: "t",
      updatedAt: "t",
    };

    expect(canEditProjectHighlights(owner, project.ownerId)).toBe(true);
    expect(canEditProjectHighlights(stranger, project.ownerId)).toBe(false);

    const updated = await updateProjectHighlights(project.projectId, "新要点");
    expect(updated.highlights).toBe("新要点");
  });
});
