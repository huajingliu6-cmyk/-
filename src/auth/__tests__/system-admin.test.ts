import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import os from "os";
import path from "path";
import {
  authenticateUser,
  createUser,
  grantSystemAdminByUsername,
  revokeSystemAdminByUsername,
  countSystemAdmins,
  listUsers,
  getUserById,
} from "@/auth/users";
import { getSystemRole } from "@/auth/roles";
import { createTestAdminUser } from "./helpers/create-test-admin-user";
import { createProjectRecord } from "@/projects/project-storage";

describe("system admin persistence and CLI semantics", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-admin-cli-"));
    process.env.APP_DATA_DIR = tmp;
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("empty user store does not auto-create admin or users.json admin", async () => {
    const users = await listUsers();
    expect(users).toEqual([]);
    expect(existsSync(path.join(tmp, "users.json"))).toBe(false);
    expect(await countSystemAdmins()).toBe(0);
    await expect(authenticateUser("admin", "Admin@123456")).resolves.toBeNull();
  });

  it("missing role field defaults to USER, never SYSTEM_ADMIN", () => {
    expect(getSystemRole({ role: undefined })).toBe("USER");
    expect(getSystemRole({ role: null })).toBe("USER");
    expect(getSystemRole({ role: "user" })).toBe("USER");
    expect(getSystemRole({ role: "hacker" })).toBe("USER");
    expect(getSystemRole({ role: "admin" })).toBe("SYSTEM_ADMIN");
  });

  it("ordinary createUser cannot self-elevate to SYSTEM_ADMIN via default", async () => {
    const member = await createUser({
      username: `member_${Date.now()}`,
      password: "Member@123456",
    });
    expect(member.role).toBe("user");
    expect(getSystemRole(member)).toBe("USER");
  });

  it("createUser rejects role admin in params", async () => {
    await expect(
      createUser({
        username: `evil_${Date.now()}`,
        password: "Member@123456",
        role: "admin",
      }),
    ).rejects.toThrow(/系统管理员/);
  });

  it("grant fails for nonexistent user without creating one", async () => {
    await expect(
      grantSystemAdminByUsername("no_such_user_xyz"),
    ).rejects.toThrow(/用户不存在/);
    expect(await listUsers()).toEqual([]);
  });

  it("CLI grant only modifies the target user and is idempotent", async () => {
    const target = await createUser({
      username: `promote_${Date.now()}`,
      password: "Member@123456",
      displayName: "ToPromote",
    });
    const other = await createUser({
      username: `other_${Date.now()}`,
      password: "Member@123456",
    });

    const first = await grantSystemAdminByUsername(target.username);
    expect(first.alreadyAdmin).toBe(false);
    expect(first.user.role).toBe("admin");
    expect(getSystemRole(first.user)).toBe("SYSTEM_ADMIN");

    const second = await grantSystemAdminByUsername(target.username);
    expect(second.alreadyAdmin).toBe(true);

    const otherAgain = await getUserById(other.id);
    expect(otherAgain?.role).toBe("user");
  });

  it("cannot revoke the last system admin", async () => {
    const admin = await createTestAdminUser({
      username: `sole_admin_${Date.now()}`,
      password: "Member@123456",
    });
    expect(await countSystemAdmins()).toBe(1);
    await expect(revokeSystemAdminByUsername(admin.username)).rejects.toThrow(
      /最后一个系统管理员/,
    );
  });

  it("cannot grant a second system admin", async () => {
    await createTestAdminUser({
      username: `first_admin_${Date.now()}`,
      password: "Member@123456",
    });
    const second = await createUser({
      username: `second_admin_${Date.now()}`,
      password: "Member@123456",
    });
    await expect(grantSystemAdminByUsername(second.username)).rejects.toThrow(
      /只允许存在 1 个/,
    );
    expect(await countSystemAdmins()).toBe(1);
  });

  it("cannot revoke the sole system admin", async () => {
    const admin = await createTestAdminUser({
      username: `sole_admin_revoke_${Date.now()}`,
      password: "Member@123456",
    });
    await expect(revokeSystemAdminByUsername(admin.username)).rejects.toThrow(
      /最后一个系统管理员/,
    );
  });

  it("persists role in users.json without password fields in public mapping", async () => {
    const member = await createUser({
      username: `persist_${Date.now()}`,
      password: "Member@123456",
    });
    await grantSystemAdminByUsername(member.username);
    const raw = JSON.parse(
      readFileSync(path.join(tmp, "users.json"), "utf-8"),
    ) as {
      users: Array<{
        username: string;
        role: string;
        passwordHash?: string;
      }>;
    };
    const stored = raw.users.find((u) => u.username === member.username);
    expect(stored?.role).toBe("admin");
    expect(typeof stored?.passwordHash).toBe("string");
  });

  it("legacy user without role field is treated as USER when reading file", async () => {
    mkdirSync(tmp, { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(
      path.join(tmp, "users.json"),
      JSON.stringify({
        version: 1,
        users: [
          {
            id: "legacy-1",
            username: "legacy_user",
            displayName: "Legacy",
            // role intentionally missing
            passwordHash: "x",
            passwordSalt: "y",
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
      "utf-8",
    );
    const users = await listUsers();
    expect(users).toHaveLength(1);
    const legacy = users.find((u) => u.username === "legacy_user");
    expect(legacy).toBeTruthy();
    expect(legacy!.role).toBe("user");
    expect(getSystemRole(legacy!)).toBe("USER");
  });

  it("listUsers / getUserById / project create do not seed admin", async () => {
    expect(await listUsers()).toEqual([]);
    expect(await getUserById("missing")).toBeNull();
    const owner = await createUser({
      username: `owner_${Date.now()}`,
      password: "Member@123456",
    });
    await createProjectRecord(owner.id, {
      name: "No Admin Seed",
      creationSource: "story",
      projectMode: "canvas",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const after = await listUsers();
    expect(after).toHaveLength(1);
    expect(after[0]!.role).toBe("user");
    expect(after.every((u) => u.username !== "admin")).toBe(true);
  });
});
