import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";
import {
  assertSmokeAppDataDirEnvIsSet,
  assertSmokeDataDirectoryIsIsolated,
  beginIsolatedSmokeAppDataSession,
  SMOKE_DIR_PREFIX,
  SMOKE_MARKER_FILE,
} from "../../../scripts/lib/smoke-app-data-guard";
import {
  createUser,
  findUserByUsername,
  grantSystemAdminByUsername,
  listUsers,
} from "@/auth/users";
import { createProjectRecord } from "@/projects/project-storage";
import { addCardEngineer, listMembershipsForUser } from "@/auth/project-members";

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

function hashTree(dir: string): string {
  const files = walkFiles(dir)
    .map((f) => path.relative(dir, f).replace(/\\/g, "/"))
    .sort();
  const h = createHash("sha256");
  for (const rel of files) {
    const abs = path.join(dir, rel);
    h.update(rel);
    h.update("\0");
    h.update(readFileSync(abs));
    h.update("\0");
  }
  return h.digest("hex");
}

describe("smoke APP_DATA_DIR isolation guard", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const repoRoot = process.cwd();
  const repoData = path.join(repoRoot, "data");
  const sessions: Array<{ cleanup: () => void }> = [];

  afterEach(() => {
    while (sessions.length) {
      try {
        sessions.pop()!.cleanup();
      } catch {
        /* ignore */
      }
    }
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
  });

  it("refuses when APP_DATA_DIR is unset", () => {
    delete process.env.APP_DATA_DIR;
    expect(() => assertSmokeAppDataDirEnvIsSet()).toThrow(/未设置/);
    expect(() =>
      beginIsolatedSmokeAppDataSession({ reuseExistingIfIsolated: true }),
    ).toThrow(/未设置/);
  });

  it("refuses repository data/ path", () => {
    expect(() =>
      assertSmokeDataDirectoryIsIsolated(repoData, {
        repoRoot,
        requireMarker: false,
      }),
    ).toThrow(/真实 data/);
  });

  it("refuses repository root path", () => {
    expect(() =>
      assertSmokeDataDirectoryIsIsolated(repoRoot, {
        repoRoot,
        requireMarker: false,
      }),
    ).toThrow(/仓库根目录/);
  });

  it("allows isolated temp APP_DATA_DIR session", () => {
    delete process.env.APP_DATA_DIR;
    const session = beginIsolatedSmokeAppDataSession();
    sessions.push(session);
    expect(session.appDataDir.includes(SMOKE_DIR_PREFIX)).toBe(true);
    expect(process.env.APP_DATA_DIR).toBe(session.appDataDir);
    expect(existsSync(path.join(session.appDataDir, SMOKE_MARKER_FILE))).toBe(
      true,
    );
    assertSmokeDataDirectoryIsIsolated(session.appDataDir, {
      repoRoot,
      smokeRunId: session.smokeRunId,
    });
  });

  it("cleans temp directory after successful session cleanup", () => {
    delete process.env.APP_DATA_DIR;
    const session = beginIsolatedSmokeAppDataSession();
    const dir = session.appDataDir;
    expect(existsSync(dir)).toBe(true);
    session.cleanup();
    expect(existsSync(dir)).toBe(false);
  });

  it("cleans temp directory when work fails", async () => {
    delete process.env.APP_DATA_DIR;
    const session = beginIsolatedSmokeAppDataSession();
    const dir = session.appDataDir;
    try {
      throw new Error("forced smoke failure");
    } catch {
      session.cleanup();
    }
    expect(existsSync(dir)).toBe(false);
  });

  it("smoke fixture writes only under temp dir and leaves real data/ hash unchanged", async () => {
    const beforeHash = hashTree(repoData);
    const adminBefore = JSON.parse(
      readFileSync(path.join(repoData, "users.json"), "utf-8"),
    ) as {
      users: Array<{
        id: string;
        username: string;
        role: string;
        passwordHash: string;
        passwordSalt: string;
        createdAt: string;
      }>;
    };
    const admin = adminBefore.users.find((u) => u.username === "admin");
    expect(admin).toBeTruthy();

    delete process.env.APP_DATA_DIR;
    const session = beginIsolatedSmokeAppDataSession();
    sessions.push(session);

    const sys = await createUser({
      username: "smoke_sysadmin",
      password: "Smoke@123456",
    });
    await grantSystemAdminByUsername(sys.username);
    const owner = await createUser({
      username: "smoke_owner",
      password: "Smoke@123456",
    });
    const engineer = await createUser({
      username: "smoke_engineer",
      password: "Smoke@123456",
    });
    const project = await createProjectRecord(owner.id, {
      name: `Smoke Project ${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });

    const tempUsers = await listUsers();
    expect(tempUsers.some((u) => u.username === "smoke_owner")).toBe(true);
    expect(
      existsSync(path.join(session.appDataDir, "users.json")),
    ).toBe(true);
    expect(
      existsSync(path.join(session.appDataDir, "project-members.json")),
    ).toBe(true);

    // Real data untouched
    const afterHash = hashTree(repoData);
    expect(afterHash).toBe(beforeHash);

    const adminAfterFile = JSON.parse(
      readFileSync(path.join(repoData, "users.json"), "utf-8"),
    ) as typeof adminBefore;
    const adminAfter = adminAfterFile.users.find((u) => u.username === "admin");
    expect(adminAfter?.id).toBe(admin!.id);
    expect(adminAfter?.role).toBe(admin!.role);
    expect(adminAfter?.passwordHash).toBe(admin!.passwordHash);
    expect(adminAfter?.passwordSalt).toBe(admin!.passwordSalt);
    expect(adminAfter?.createdAt).toBe(admin!.createdAt);

    // smoke users only in temp
    const realText = readFileSync(path.join(repoData, "users.json"), "utf-8");
    expect(realText.includes("smoke_owner")).toBe(false);
    expect(realText.includes("smoke_engineer")).toBe(false);
    expect(realText.includes("smoke_sysadmin")).toBe(false);

    const memberships = await listMembershipsForUser(engineer.id);
    expect(memberships.some((m) => m.projectId === project.projectId)).toBe(
      true,
    );
    expect(await findUserByUsername("smoke_owner")).toBeTruthy();

    session.cleanup();
    expect(existsSync(session.appDataDir)).toBe(false);
    expect(hashTree(repoData)).toBe(beforeHash);
  }, 15_000);

  it("rejects existing APP_DATA_DIR pointing at repo data even if prefixed name tricks", () => {
    const trap = path.join(repoData, `${SMOKE_DIR_PREFIX}trap`);
    mkdirSync(trap, { recursive: true });
    try {
      writeFileSync(path.join(trap, SMOKE_MARKER_FILE), "trap", "utf-8");
      process.env.APP_DATA_DIR = trap;
      expect(() =>
        beginIsolatedSmokeAppDataSession({ reuseExistingIfIsolated: true }),
      ).toThrow(/真实 data/);
    } finally {
      rmSync(trap, { recursive: true, force: true });
    }
  });

  it("rejects non-marker temp directories", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), `${SMOKE_DIR_PREFIX}nomarker-`));
    try {
      expect(() =>
        assertSmokeDataDirectoryIsIsolated(tmp, {
          repoRoot,
          requireMarker: true,
        }),
      ).toThrow(/标记文件/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
