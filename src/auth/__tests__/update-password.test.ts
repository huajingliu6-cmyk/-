import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authenticateUser, updateUserPassword } from "@/auth/users";
import { createTestAdminUser } from "./helpers/create-test-admin-user";

describe("updateUserPassword", () => {
  const PASSWORD = "test-bootstrap-password-9";
  let tmp: string;
  let previousAppDataDir: string | undefined;

  beforeEach(async () => {
    previousAppDataDir = process.env.APP_DATA_DIR;
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth-pwd-"));
    process.env.APP_DATA_DIR = tmp;
  });

  afterEach(async () => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("rejects empty current password", async () => {
    const admin = await createTestAdminUser({
      username: "pwd_admin",
      password: PASSWORD,
    });
    await expect(
      updateUserPassword(admin.id, {
        currentPassword: "",
        newPassword: "new-secret-1",
      }),
    ).rejects.toThrow("请输入当前密码");
  });

  it("rejects short new password", async () => {
    const admin = await createTestAdminUser({
      username: "pwd_admin",
      password: PASSWORD,
    });
    await expect(
      updateUserPassword(admin.id, {
        currentPassword: PASSWORD,
        newPassword: "123",
      }),
    ).rejects.toThrow("新密码至少 6 个字符");
  });

  it("rejects new password equal to current", async () => {
    const admin = await createTestAdminUser({
      username: "pwd_admin",
      password: PASSWORD,
    });
    await expect(
      updateUserPassword(admin.id, {
        currentPassword: PASSWORD,
        newPassword: PASSWORD,
      }),
    ).rejects.toThrow("新密码不能与当前密码相同");
  });

  it("rejects wrong current password", async () => {
    const admin = await createTestAdminUser({
      username: "pwd_admin",
      password: PASSWORD,
    });
    await expect(
      updateUserPassword(admin.id, {
        currentPassword: "definitely-wrong-password",
        newPassword: "new-secret-1",
      }),
    ).rejects.toThrow("当前密码不正确");
  });

  it("updates password and allows login with new credentials", async () => {
    const admin = await createTestAdminUser({
      username: "pwd_admin",
      password: PASSWORD,
    });
    const next = "new-strong-password";
    await updateUserPassword(admin.id, {
      currentPassword: PASSWORD,
      newPassword: next,
    });
    await expect(authenticateUser("pwd_admin", PASSWORD)).resolves.toBeNull();
    const loggedIn = await authenticateUser("pwd_admin", next);
    expect(loggedIn?.id).toBe(admin.id);
  });
});
