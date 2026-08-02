/**
 * One-shot clean-start smoke: create a single project in the local DEV database.
 * Uses Prisma directly (no Next server-only imports).
 * Does not write data/projects. Not a legacy import.
 *
 *   $env:DATABASE_URL="postgresql://ic_dev:***@localhost:5432/infinite_canvas?schema=public"
 *   npx tsx scripts/smoke-postgres-project-create.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";

type StoredUser = {
  id: string;
  username: string;
  role: "admin" | "user";
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt: string;
};

async function main() {
  const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (
    databaseUrl.includes("infinite_canvas_test") ||
    databaseUrl.includes(":5433/")
  ) {
    throw new Error("Refuse smoke against test database");
  }
  if (!/\/infinite_canvas(\?|$)/.test(databaseUrl) || !databaseUrl.includes(":5432")) {
    throw new Error("Refuse smoke: expected local infinite_canvas on port 5432");
  }

  const usersPath = path.join(process.cwd(), "data", "users.json");
  const usersFile = JSON.parse(await fs.readFile(usersPath, "utf-8")) as {
    users: StoredUser[];
  };
  const admin = usersFile.users.find((u) => u.role === "admin");
  if (!admin) {
    throw new Error("No admin user in data/users.json");
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  const usersBefore = await prisma.user.count();
  const projectsBefore = await prisma.project.count();

  if (projectsBefore > 0) {
    const existing = await prisma.project.findMany({
      select: { id: true, name: true },
      take: 5,
    });
    await prisma.$disconnect();
    console.log(
      JSON.stringify(
        {
          ok: false,
          blocked: true,
          reason: "Dev Project table is not empty — refuse clean-start write",
          projectsBefore,
          sample: existing,
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }

  // Clean-start identity bootstrap (not legacy import): upsert current auth user only.
  await prisma.user.upsert({
    where: { id: admin.id },
    create: {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      status: "active",
      passwordHash: admin.passwordHash,
      passwordSalt: admin.passwordSalt,
      createdAt: new Date(admin.createdAt),
      updatedAt: new Date(admin.updatedAt),
    },
    update: {
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      passwordHash: admin.passwordHash,
      passwordSalt: admin.passwordSalt,
      updatedAt: new Date(admin.updatedAt),
    },
  });

  const projectId = `p_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date();
  const idempotencyKey = `smoke-b0b1-${admin.id}`;

  const prior = await prisma.project.findUnique({
    where: { creationIdempotencyKey: idempotencyKey },
  });

  const project =
    prior ??
    (await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          id: projectId,
          ownerId: admin.id,
          name: `Clean Start ${now.toISOString().slice(0, 19).replace("T", " ")}`,
          creationSource: "story",
          projectMode: "canvas",
          currentStage: "story_creation",
          highlights:
            "B0-B1 clean-start smoke project — keep for local postgres mode",
          passwordEnabled: false,
          passwordHash: null,
          passwordSalt: null,
          creationIdempotencyKey: idempotencyKey,
          rootFolderId: projectId,
          revision: 1,
          status: "draft",
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.projectMember.create({
        data: {
          id: `pm_${projectId}`,
          projectId,
          userId: admin.id,
          role: "owner",
          createdAt: now,
          updatedAt: now,
        },
      });
      return created;
    }));

  const usersAfter = await prisma.user.count();
  const projectsAfter = await prisma.project.count();

  const metaPath = path.join(
    process.cwd(),
    "data",
    "projects",
    `${project.id}.json`,
  );
  let wroteFileMeta = false;
  try {
    await fs.access(metaPath);
    wroteFileMeta = true;
  } catch {
    wroteFileMeta = false;
  }

  await prisma.$disconnect();

  console.log(
    JSON.stringify(
      {
        ok: !wroteFileMeta,
        projectId: project.id,
        rootFolderId: project.rootFolderId,
        ownerId: project.ownerId,
        name: project.name,
        usersBefore,
        usersAfter,
        projectsBefore,
        projectsAfter,
        wroteDataProjectsMeta: wroteFileMeta,
        reused: Boolean(prior),
        note: "Keep this project as the first clean-start development project.",
      },
      null,
      2,
    ),
  );

  if (wroteFileMeta) process.exitCode = 1;
}

main().catch((error) => {
  console.error("smoke failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
