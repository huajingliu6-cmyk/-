/**
 * Local smoke fixture for permission browser checks.
 * Always uses an isolated OS temp APP_DATA_DIR — never the repository data/.
 * Does not print password hashes. Does not auto-bootstrap a default admin.
 */
import {
  createUser,
  findUserByUsername,
  grantSystemAdminByUsername,
} from "../src/auth/users";
import { createProjectRecord } from "../src/projects/project-storage";
import {
  addCardEngineer,
  listMembershipsForUser,
} from "../src/auth/project-members";
import { beginIsolatedSmokeAppDataSession } from "./lib/smoke-app-data-guard";

const SYSADMIN_USERNAME = "smoke_sysadmin";
const OWNER_USERNAME = "smoke_owner";
const ENGINEER_USERNAME = "smoke_engineer";
const PASSWORD = "Smoke@123456";

async function ensureNamedUser(username: string, displayName: string) {
  try {
    return await createUser({
      username,
      password: PASSWORD,
      displayName,
    });
  } catch (error) {
    if (error instanceof Error && /已存在/.test(error.message)) {
      const existing = await findUserByUsername(username);
      if (!existing) throw error;
      return {
        id: existing.id,
        username: existing.username,
        role: (existing.role === "admin" ? "admin" : "user") as "admin" | "user",
        displayName: existing.displayName,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }
    throw error;
  }
}

async function runFixture() {
  const adminUser = await ensureNamedUser(SYSADMIN_USERNAME, "Smoke Sysadmin");
  const admin = (await grantSystemAdminByUsername(adminUser.username)).user;
  const owner = await ensureNamedUser(OWNER_USERNAME, "Smoke Owner");
  const engineer = await ensureNamedUser(ENGINEER_USERNAME, "Smoke Engineer");

  const project = await createProjectRecord(owner.id, {
    name: `Smoke Project ${Date.now()}`,
    creationSource: "story",
    projectMode: "full-stack",
    passwordEnabled: false,
  });

  const memberships = await listMembershipsForUser(engineer.id);
  if (!memberships.some((m) => m.projectId === project.projectId)) {
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
  }

  const other = await createProjectRecord(admin.id, {
    name: `Smoke Other ${Date.now()}`,
    creationSource: "story",
    projectMode: "canvas",
    passwordEnabled: false,
  });

  return {
    ok: true as const,
    adminUsername: admin.username,
    ownerUsername: owner.username,
    engineerUsername: engineer.username,
    passwordHint: PASSWORD,
    assignedProjectId: project.projectId,
    unassignedProjectId: other.projectId,
  };
}

async function main() {
  const keep =
    process.env.SMOKE_KEEP_APP_DATA_DIR === "1" ||
    process.env.SMOKE_KEEP_APP_DATA_DIR === "true";
  const session = beginIsolatedSmokeAppDataSession();
  let failed = false;
  try {
    const result = await runFixture();
    console.log(
      JSON.stringify({
        ...result,
        appDataDir: session.appDataDir,
        smokeRunId: session.smokeRunId,
        keepAppDataDir: keep,
        hint: keep
          ? "已保留临时目录；启动开发服务器/check 时请设置相同 APP_DATA_DIR"
          : "默认会清理临时目录；若需对接浏览器/服务端请设 SMOKE_KEEP_APP_DATA_DIR=1",
      }),
    );
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (failed || !keep) {
      session.cleanup();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
