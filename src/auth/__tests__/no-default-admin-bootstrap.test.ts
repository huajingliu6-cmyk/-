import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { listUsers, createUser } from "@/auth/users";
import { POST as loginPost } from "@/app/api/auth/login/route";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
  })),
}));

describe("no default admin bootstrap on API paths", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-no-admin-"));
    process.env.APP_DATA_DIR = tmp;
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  function usersJsonAdminCount(): number {
    const file = path.join(tmp, "users.json");
    if (!existsSync(file)) return 0;
    const raw = JSON.parse(readFileSync(file, "utf-8")) as {
      users?: Array<{ role?: string }>;
    };
    return (raw.users ?? []).filter((u) => u.role === "admin").length;
  }

  it("login with nonexistent admin fails and does not create users", async () => {
    const res = await loginPost(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "Admin@123456" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(await listUsers()).toEqual([]);
    expect(usersJsonAdminCount()).toBe(0);
  });

  it("auth/me without session does not create admin", async () => {
    const { GET: meGet } = await import("@/app/api/auth/me/route");
    const res = await meGet();
    expect(res.status).toBe(401);
    expect(await listUsers()).toEqual([]);
    expect(usersJsonAdminCount()).toBe(0);
  });

  it("auth/navigation without session does not create admin", async () => {
    const { GET: navigationGet } = await import(
      "@/app/api/auth/navigation/route"
    );
    const res = await navigationGet();
    expect(res.status).toBe(401);
    expect(await listUsers()).toEqual([]);
    expect(usersJsonAdminCount()).toBe(0);
  });

  it("creating an ordinary user does not invent a separate admin", async () => {
    const user = await createUser({
      username: "plain_user",
      password: "Member@123456",
    });
    expect(user.role).toBe("user");
    const all = await listUsers();
    expect(all).toHaveLength(1);
    expect(usersJsonAdminCount()).toBe(0);
  });
});
