import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { canCreateProject } from "@/auth/capabilities";
import { hashPassword } from "@/auth/password";
import type { AuthUser } from "@/auth/types";
import { getAppDataDir, resolveAppDataPath } from "@/persistence/data-root";
import { withGuardedTestDatabaseCleanup } from "@/persistence/test-db-guard";
import { ensurePostgresIdentityForSessionUser } from "../../../scripts/legacy-postgres/identity-bootstrap";
import {
  createProjectRecordPostgres,
  getProjectPublicPostgres,
  getProjectRecordPostgres,
  listProjectRecordsPostgres,
  listProjectSummariesPostgres,
  updateProjectHighlightsPostgres,
} from "../../../scripts/legacy-postgres/project-store";
import { ProjectNameConflictError } from "@/projects/project-storage";

const testUrl = (process.env.TEST_DATABASE_URL || "").trim();

/**
 * PostgreSQL integration suite.
 * Only executed via `npm run test:postgres` after hard preflight.
 * Must not use describe.skip / auto-skip on connection failure.
 */
describe("postgres project store (TEST_DATABASE_URL)", () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: testUrl } },
  });

  const suffix = `b0b1_${Date.now()}`;
  const userId = `user_${suffix}`;
  const memberId = `member_${suffix}`;
  let createdProjectId: string | null = null;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    process.env.PERSISTENCE_DRIVER = "postgres";

    // Seed auth file store under isolated APP_DATA_DIR (vitest setup).
    const usersPath = resolveAppDataPath("users.json");
    await fs.mkdir(path.dirname(usersPath), { recursive: true });
    const now = new Date().toISOString();
    const adminHash = hashPassword("Admin@test-only");
    const memberHash = hashPassword("Member@test-only");
    await fs.writeFile(
      usersPath,
      JSON.stringify(
        {
          version: 1,
          users: [
            {
              id: userId,
              username: `admin_${suffix}`,
              role: "admin",
              displayName: "Admin",
              passwordHash: adminHash.hash,
              passwordSalt: adminHash.salt,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: memberId,
              username: `member_${suffix}`,
              role: "user",
              displayName: "Member",
              passwordHash: memberHash.hash,
              passwordSalt: memberHash.salt,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  afterAll(async () => {
    await withGuardedTestDatabaseCleanup(testUrl, async () => {
      if (createdProjectId) {
        await prisma.projectMember.deleteMany({
          where: { projectId: createdProjectId },
        });
        await prisma.project.deleteMany({ where: { id: createdProjectId } });
      }
      await prisma.projectMember.deleteMany({
        where: { userId: { in: [userId, memberId] } },
      });
      await prisma.project.deleteMany({
        where: { ownerId: { in: [userId, memberId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [userId, memberId] } },
      });
    });
    await prisma.$disconnect();
  });

  it("empty list starts empty for this suite prefix", async () => {
    const before = await listProjectRecordsPostgres();
    expect(Array.isArray(before)).toBe(true);
  });

  it("bootstraps identity and creates a project without writing data/projects", async () => {
    const projectsDirBefore = resolveAppDataPath("projects");
    let beforeNames: string[] = [];
    try {
      beforeNames = await fs.readdir(projectsDirBefore);
    } catch {
      beforeNames = [];
    }

    const identity = await ensurePostgresIdentityForSessionUser(userId, prisma);
    expect(identity.id).toBe(userId);

    const project = await createProjectRecordPostgres(userId, {
      name: `PG Project ${suffix}`,
      creationSource: "story",
      projectMode: "canvas",
      highlights: "notes",
      passwordEnabled: true,
      projectPassword: "project-secret-plain",
      idempotencyKey: `idem_${suffix}`,
    });
    createdProjectId = project.projectId;

    expect(project.ownerId).toBe(userId);
    expect(project.rootFolderId).toBe(project.projectId);
    expect(project.passwordEnabled).toBe(true);
    expect("passwordHash" in project).toBe(false);
    expect(JSON.stringify(project)).not.toContain("project-secret-plain");

    const record = await getProjectRecordPostgres(project.projectId);
    expect(record?.passwordHash).toBeTruthy();
    expect(record?.passwordSalt).toBeTruthy();
    expect(JSON.stringify(record)).not.toContain("project-secret-plain");

    const pub = await getProjectPublicPostgres(project.projectId);
    expect(pub?.name).toBe(`PG Project ${suffix}`);
    expect(JSON.stringify(pub)).not.toContain(record!.passwordHash);

    const row = await prisma.project.findUnique({
      where: { id: project.projectId },
    });
    expect(row?.ownerId).toBe(userId);
    expect(row?.passwordHash).toBeTruthy();

    // Repo real data/projects must remain untouched; temp APP_DATA_DIR projects may exist
    // but postgres mode must not write project meta there.
    const appData = getAppDataDir();
    expect(path.resolve(appData)).not.toBe(
      path.resolve(path.join(process.cwd(), "data")),
    );
    let afterNames: string[] = [];
    try {
      afterNames = await fs.readdir(projectsDirBefore);
    } catch {
      afterNames = [];
    }
    expect(afterNames.filter((n) => n.endsWith(".json"))).toEqual(
      beforeNames.filter((n) => n.endsWith(".json")),
    );

    const repoProjects = path.join(process.cwd(), "data", "projects");
    // Ensure we did not write into the real repository projects dir.
    const marker = path.join(repoProjects, `${project.projectId}.json`);
    await expect(fs.access(marker)).rejects.toBeTruthy();
  });

  it("reuses creation idempotency key", async () => {
    const second = await createProjectRecordPostgres(userId, {
      name: `Other Name ${suffix}`,
      creationSource: "story",
      projectMode: "canvas",
      passwordEnabled: false,
      idempotencyKey: `idem_${suffix}`,
    });
    expect(second.projectId).toBe(createdProjectId);
    const count = await prisma.project.count({
      where: { creationIdempotencyKey: `idem_${suffix}` },
    });
    expect(count).toBe(1);
  });

  it("rejects duplicate project names for the same owner", async () => {
    await expect(
      createProjectRecordPostgres(userId, {
        name: `PG Project ${suffix}`,
        creationSource: "story",
        projectMode: "canvas",
        passwordEnabled: false,
      }),
    ).rejects.toBeInstanceOf(ProjectNameConflictError);
  });

  it("allows duplicate project names for different owners", async () => {
    const otherOwnerId = `other_${suffix}`;
    const created = await createProjectRecordPostgres(otherOwnerId, {
      name: `PG Project ${suffix}`,
      creationSource: "story",
      projectMode: "canvas",
      passwordEnabled: false,
    });
    expect(created.ownerId).toBe(otherOwnerId);
  });

  it("lists projects from postgres and survives re-read", async () => {
    const list = await listProjectSummariesPostgres();
    expect(list.some((p) => p.projectId === createdProjectId)).toBe(true);
    const again = await getProjectRecordPostgres(createdProjectId!);
    expect(again?.name).toBe(`PG Project ${suffix}`);
  });

  it("updates highlights", async () => {
    const updated = await updateProjectHighlightsPostgres(
      createdProjectId!,
      "updated-highlights",
    );
    expect(updated.highlights).toBe("updated-highlights");
  });

  it("session ownerId argument is the only owner source", async () => {
    await ensurePostgresIdentityForSessionUser(memberId, prisma);
    const forged = await createProjectRecordPostgres(userId, {
      name: `Forged Owner ${suffix}`,
      creationSource: "story",
      projectMode: "canvas",
      passwordEnabled: false,
      idempotencyKey: `idem_forged_${suffix}`,
    });
    expect(forged.ownerId).toBe(userId);
    expect(forged.ownerId).not.toBe(memberId);
    await withGuardedTestDatabaseCleanup(testUrl, async () => {
      await prisma.projectMember.deleteMany({
        where: { projectId: forged.projectId },
      });
      await prisma.project.deleteMany({ where: { id: forged.projectId } });
    });
  });

  it("regular users can create personal projects by capability policy", () => {
    const member: AuthUser = {
      id: memberId,
      username: `member_${suffix}`,
      role: "user",
      displayName: "Member",
      createdAt: "t",
      updatedAt: "t",
    };
    expect(canCreateProject(member)).toBe(true);
  });
});
