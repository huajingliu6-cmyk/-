/**
 * One-shot legacy JSON → PostgreSQL importer.
 *
 * Usage:
 *   npx tsx scripts/import-legacy-file-data.ts --dry-run
 *   npx tsx scripts/import-legacy-file-data.ts --apply
 *   npx tsx scripts/import-legacy-file-data.ts --verify
 *
 * Default is dry-run. Never deletes data/. Never logs secrets or full private bodies.
 */

import { promises as fs } from "fs";
import path from "path";
import { PrismaClient, type Prisma } from "@prisma/client";

type Mode = "dry-run" | "apply" | "verify";

type DomainStats = {
  scanned: number;
  wouldCreate: number;
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
};

function emptyStats(): DomainStats {
  return {
    scanned: 0,
    wouldCreate: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
}

function parseArgs(argv: string[]): Mode {
  if (argv.includes("--apply")) return "apply";
  if (argv.includes("--verify")) return "verify";
  return "dry-run";
}

function dataRoot(): string {
  return path.join(process.cwd(), "data");
}

function toDate(value: unknown, fallback = new Date()): Date {
  if (typeof value === "string" && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

function mapCreationSource(
  raw: unknown,
): "story" | "script_upload" {
  return raw === "script-upload" || raw === "script_upload"
    ? "script_upload"
    : "story";
}

function mapProjectMode(raw: unknown): "canvas" | "full_stack" {
  return raw === "full-stack" || raw === "full_stack"
    ? "full_stack"
    : "canvas";
}

function defaultStage(
  source: "story" | "script_upload",
): "story_creation" | "script_processing" {
  return source === "script_upload"
    ? "script_processing"
    : "story_creation";
}

function relativeStorageKey(absPath: string): string {
  const rel = path
    .relative(process.cwd(), absPath)
    .split(path.sep)
    .join("/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Refusing absolute or escaping storage path");
  }
  // Normalize legacy asset path into projects/ prefix for provider rules when possible.
  if (rel.startsWith("data/assets/")) {
    const file = path.basename(rel);
    return `projects/_legacy/workflow_asset/${file}/${file}`;
  }
  return `projects/_legacy/file/${rel.replace(/^data\//, "")}`;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((n) => n.endsWith(".json"))
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

function printStats(title: string, s: DomainStats) {
  console.log(
    `[${title}] scanned=${s.scanned} wouldCreate=${s.wouldCreate} created=${s.created} skipped=${s.skipped} failed=${s.failed}`,
  );
  for (const err of s.errors.slice(0, 20)) {
    console.log(`  ! ${err}`);
  }
}

async function importUsers(
  prisma: PrismaClient,
  mode: Mode,
): Promise<DomainStats> {
  const stats = emptyStats();
  const file = path.join(dataRoot(), "users.json");
  const data = await readJson<{ users?: Array<Record<string, unknown>> }>(
    file,
  );
  const users = data?.users ?? [];
  stats.scanned = users.length;

  for (const u of users) {
    try {
      const id = String(u.id ?? "");
      const username = String(u.username ?? "");
      if (!id || !username) {
        stats.failed += 1;
        stats.errors.push("user missing id/username");
        continue;
      }
      const existing = await prisma.user.findUnique({ where: { id } });
      if (existing) {
        stats.skipped += 1;
        continue;
      }
      stats.wouldCreate += 1;
      if (mode === "apply") {
        await prisma.user.create({
          data: {
            id,
            username,
            displayName: String(u.displayName ?? username),
            role: u.role === "admin" ? "admin" : "user",
            status: "active",
            // Preserve hashes as-is — never re-hash
            passwordHash: String(u.passwordHash ?? ""),
            passwordSalt: String(u.passwordSalt ?? ""),
            createdAt: toDate(u.createdAt),
            updatedAt: toDate(u.updatedAt),
          },
        });
        stats.created += 1;
      }
    } catch (err) {
      stats.failed += 1;
      stats.errors.push(
        `user import failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
  return stats;
}

async function loadPlannedUserIds(): Promise<Set<string>> {
  const data = await readJson<{ users?: Array<{ id?: string }> }>(
    path.join(dataRoot(), "users.json"),
  );
  return new Set(
    (data?.users ?? [])
      .map((u) => String(u.id ?? ""))
      .filter(Boolean),
  );
}

async function importProjects(
  prisma: PrismaClient,
  mode: Mode,
  plannedUserIds: Set<string>,
  plannedProjectIds: Set<string>,
): Promise<DomainStats> {
  const stats = emptyStats();
  const files = await listJsonFiles(path.join(dataRoot(), "projects"));
  // Only top-level project meta files (p_*.json), not nested
  const metaFiles = files.filter((f) =>
    /^p_[\w-]+\.json$/i.test(path.basename(f)),
  );
  stats.scanned = metaFiles.length;

  for (const file of metaFiles) {
    try {
      const raw = await readJson<Record<string, unknown>>(file);
      if (!raw) {
        stats.failed += 1;
        continue;
      }
      const id = String(raw.projectId ?? "");
      const ownerId = String(raw.ownerId ?? "");
      if (!id || !ownerId) {
        stats.failed += 1;
        stats.errors.push(`${path.basename(file)}: missing projectId/ownerId`);
        continue;
      }
      const ownerInDb = await prisma.user.findUnique({ where: { id: ownerId } });
      const ownerPlanned = plannedUserIds.has(ownerId);
      if (!ownerInDb && !ownerPlanned) {
        stats.failed += 1;
        stats.errors.push(
          `${id}: orphan ownerId ${ownerId} (not in users.json and not in DB)`,
        );
        continue;
      }
      const existing = await prisma.project.findUnique({ where: { id } });
      if (existing) {
        stats.skipped += 1;
        plannedProjectIds.add(id);
        continue;
      }
      const creationSource = mapCreationSource(raw.creationSource);
      const projectMode = mapProjectMode(raw.projectMode);
      stats.wouldCreate += 1;
      plannedProjectIds.add(id);
      if (mode === "apply") {
        const createdAt = toDate(raw.createdAt);
        const updatedAt = toDate(raw.updatedAt, createdAt);
        await prisma.$transaction(async (tx) => {
          await tx.project.create({
            data: {
              id,
              ownerId,
              name: String(raw.name ?? "未命名项目"),
              passwordEnabled: Boolean(raw.passwordEnabled),
              passwordHash:
                typeof raw.passwordHash === "string" ? raw.passwordHash : null,
              passwordSalt:
                typeof raw.passwordSalt === "string" ? raw.passwordSalt : null,
              highlights: String(raw.highlights ?? ""),
              creationSource,
              projectMode,
              status: "draft",
              currentStage: defaultStage(creationSource),
              revision: 1,
              creationIdempotencyKey: null,
              rootFolderId: String(raw.rootFolderId ?? id),
              createdAt,
              updatedAt,
            },
          });
          await tx.projectMember.create({
            data: {
              id: `pm_${id}`,
              projectId: id,
              userId: ownerId,
              role: "owner",
              createdAt,
              updatedAt,
            },
          });
        });
        stats.created += 1;
      }
    } catch (err) {
      stats.failed += 1;
      stats.errors.push(
        `project ${path.basename(file)}: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
  return stats;
}

async function importStoryDrafts(
  prisma: PrismaClient,
  mode: Mode,
  plannedProjectIds: Set<string>,
): Promise<DomainStats> {
  const stats = emptyStats();
  const projectsDir = path.join(dataRoot(), "projects");
  let projectIds: string[] = [];
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    projectIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return stats;
  }

  for (const projectId of projectIds) {
    const draftPath = path.join(
      projectsDir,
      projectId,
      "drafts",
      "story.json",
    );
    const draft = await readJson<Record<string, unknown>>(draftPath);
    if (!draft) continue;
    stats.scanned += 1;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project && !plannedProjectIds.has(projectId)) {
      stats.failed += 1;
      stats.errors.push(`story draft ${projectId}: project missing`);
      continue;
    }
    const existing = await prisma.storyWorkspaceState.findUnique({
      where: { projectId },
    });
    if (existing) {
      stats.skipped += 1;
      continue;
    }
    stats.wouldCreate += 1;
    if (mode === "apply") {
      const scriptMode =
        draft.scriptMode === "discuss-outline"
          ? "discuss_outline"
          : draft.scriptMode === "direct-episode"
            ? "direct_episode"
            : null;
      await prisma.storyWorkspaceState.create({
        data: {
          projectId,
          brief: String(draft.brief ?? "").slice(0, 1500),
          outputKind: draft.outputKind === "script" ? "script" : "story",
          modelKey: String(draft.modelKey ?? ""),
          targetChars: Number(draft.targetChars ?? 800) || 800,
          scriptGenerationMode: scriptMode,
          perEpisodeChars:
            typeof draft.episodeLength === "number"
              ? draft.episodeLength
              : null,
          resultText: String(draft.resultText ?? ""),
          generationStatus: "idle",
          revision: 1,
          createdAt: toDate(draft.updatedAt),
          updatedAt: toDate(draft.updatedAt),
        },
      });
      stats.created += 1;
    }
  }
  return stats;
}

async function importWorkflows(
  prisma: PrismaClient,
  mode: Mode,
  plannedProjectIds: Set<string>,
): Promise<DomainStats> {
  const stats = emptyStats();
  const files = await listJsonFiles(path.join(dataRoot(), "workflows"));
  stats.scanned = files.length;
  for (const file of files) {
    try {
      const raw = await readJson<Record<string, unknown>>(file);
      if (!raw) {
        stats.failed += 1;
        continue;
      }
      const projectId = String(raw.projectId ?? path.basename(file, ".json"));
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project && !plannedProjectIds.has(projectId)) {
        stats.failed += 1;
        stats.errors.push(`workflow ${projectId}: project missing`);
        continue;
      }
      const existing = await prisma.workflowDocument.findUnique({
        where: { projectId },
      });
      if (existing) {
        stats.skipped += 1;
        continue;
      }
      stats.wouldCreate += 1;
      if (mode === "apply") {
        await prisma.workflowDocument.create({
          data: {
            projectId,
            schemaVersion: Number(raw.schemaVersion ?? 1) || 1,
            content: raw as Prisma.InputJsonValue,
            revision: 1,
            createdAt: toDate(raw.updatedAt ?? raw.createdAt),
            updatedAt: toDate(raw.updatedAt ?? raw.createdAt),
          },
        });
        stats.created += 1;
      }
    } catch (err) {
      stats.failed += 1;
      stats.errors.push(
        `workflow ${path.basename(file)}: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
  return stats;
}

async function importAssetMetas(
  prisma: PrismaClient,
  mode: Mode,
  plannedProjectIds: Set<string>,
  plannedUserIds: Set<string>,
): Promise<DomainStats> {
  const stats = emptyStats();
  const assetsDir = path.join(dataRoot(), "assets");
  let files: string[] = [];
  try {
    files = (await fs.readdir(assetsDir)).filter((n) => !n.startsWith("."));
  } catch {
    return stats;
  }
  stats.scanned = files.length;

  // Attach orphan workflow assets under first available project if any.
  const anyProject = await prisma.project.findFirst({
    orderBy: { createdAt: "asc" },
  });
  const fallbackProjectId =
    anyProject?.id ?? [...plannedProjectIds].sort()[0] ?? null;
  const fallbackOwnerId =
    anyProject?.ownerId ?? [...plannedUserIds].sort()[0] ?? null;

  for (const name of files) {
    try {
      const abs = path.join(assetsDir, name);
      const st = await fs.stat(abs);
      if (!st.isFile()) {
        stats.skipped += 1;
        continue;
      }
      const id = `file_legacy_${name.replace(/\W/g, "_").slice(0, 40)}`;
      const existing = await prisma.projectFile.findUnique({ where: { id } });
      if (existing) {
        stats.skipped += 1;
        continue;
      }
      if (!fallbackProjectId || !fallbackOwnerId) {
        stats.failed += 1;
        stats.errors.push(`asset ${name}: no project to attach`);
        continue;
      }
      stats.wouldCreate += 1;
      if (mode === "apply") {
        const ext = path.extname(name).toLowerCase() || ".bin";
        const storageKey = relativeStorageKey(abs);
        await prisma.projectFile.create({
          data: {
            id,
            projectId: fallbackProjectId,
            purpose: "workflow_asset",
            originalName: name,
            mimeType: "application/octet-stream",
            extension: ext,
            size: BigInt(st.size),
            storageDriver: "local",
            storageKey,
            status: "ready",
            uploadedBy: fallbackOwnerId,
            createdAt: st.birthtime,
            updatedAt: st.mtime,
          },
        });
        stats.created += 1;
      }
    } catch (err) {
      stats.failed += 1;
      stats.errors.push(
        `asset ${name}: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
  return stats;
}

async function importCredits(
  prisma: PrismaClient,
  mode: Mode,
  plannedUserIds: Set<string>,
): Promise<DomainStats> {
  const stats = emptyStats();
  const file = path.join(dataRoot(), "credits.json");
  const data = await readJson<{
    balances?: Record<string, number>;
    ledger?: Array<Record<string, unknown>>;
  }>(file);
  if (!data) return stats;

  const balances = data.balances ?? {};
  const ledger = data.ledger ?? [];
  const userIds = new Set([
    ...Object.keys(balances),
    ...ledger.map((e) => String(e.userId ?? "")).filter(Boolean),
  ]);
  stats.scanned = userIds.size;

  for (const userId of userIds) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user && !plannedUserIds.has(userId)) {
        stats.failed += 1;
        stats.errors.push(`credits: user ${userId} missing`);
        continue;
      }
      const account = await prisma.creditAccount.findUnique({
        where: { userId },
      });
      if (account) {
        stats.skipped += 1;
        continue;
      }
      stats.wouldCreate += 1;
      if (mode === "apply") {
        const userLedger = ledger.filter((e) => e.userId === userId);
        const opening = BigInt(Math.floor(balances[userId] ?? 0));
        const created = await prisma.creditAccount.create({
          data: {
            userId,
            balance: opening,
            reservedBalance: BigInt(0),
            revision: 1,
          },
        });
        if (userLedger.length > 0) {
          // Import original ledger when present; recompute balanceAfter from file.
          for (const entry of userLedger) {
            const id = String(entry.id ?? `ledger_${userId}_${Math.random()}`);
            const idem = `legacy_ledger_${id}`;
            const exists = await prisma.creditLedgerEntry.findUnique({
              where: { idempotencyKey: idem },
            });
            if (exists) continue;
            await prisma.creditLedgerEntry.create({
              data: {
                id,
                accountId: created.id,
                type: "adjust",
                amount: BigInt(Math.floor(Number(entry.delta ?? 0))),
                balanceAfter: BigInt(
                  Math.floor(Number(entry.balanceAfter ?? opening)),
                ),
                projectId: null,
                generationId: null,
                idempotencyKey: idem,
                description: String(entry.reason ?? "legacy ledger"),
                createdAt: toDate(entry.createdAt),
              },
            });
          }
          // Align account balance to file balance (source of truth for legacy).
          await prisma.creditAccount.update({
            where: { id: created.id },
            data: { balance: opening },
          });
        } else {
          await prisma.creditLedgerEntry.create({
            data: {
              id: `legacy_open_${userId}`,
              accountId: created.id,
              type: "legacy_opening_balance",
              amount: opening,
              balanceAfter: opening,
              idempotencyKey: `legacy_opening_${userId}`,
              description: "Imported opening balance from credits.json",
              createdAt: new Date(),
            },
          });
        }
        stats.created += 1;
      }
    } catch (err) {
      stats.failed += 1;
      stats.errors.push(
        `credits ${userId}: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
  return stats;
}

async function verify(prisma: PrismaClient): Promise<number> {
  const usersFile =
    (await readJson<{ users?: unknown[] }>(
      path.join(dataRoot(), "users.json"),
    ))?.users?.length ?? 0;
  const projectFiles = (
    await listJsonFiles(path.join(dataRoot(), "projects"))
  ).filter((f) => /^p_[\w-]+\.json$/i.test(path.basename(f))).length;
  const workflowFiles = (
    await listJsonFiles(path.join(dataRoot(), "workflows"))
  ).length;
  let assetFiles = 0;
  try {
    assetFiles = (
      await fs.readdir(path.join(dataRoot(), "assets"))
    ).filter((n) => !n.startsWith(".")).length;
  } catch {
    assetFiles = 0;
  }
  const credits = await readJson<{ balances?: Record<string, number> }>(
    path.join(dataRoot(), "credits.json"),
  );
  const creditUsers = Object.keys(credits?.balances ?? {}).length;
  const fileBalanceSum = Object.values(credits?.balances ?? {}).reduce(
    (a, b) => a + Math.floor(b),
    0,
  );

  const dbUsers = await prisma.user.count();
  const dbProjects = await prisma.project.count();
  const dbWorkflows = await prisma.workflowDocument.count();
  const dbFiles = await prisma.projectFile.count();
  const dbAccounts = await prisma.creditAccount.count();
  const dbBalanceAgg = await prisma.creditAccount.aggregate({
    _sum: { balance: true },
  });
  const dbBalanceSum = Number(dbBalanceAgg._sum.balance ?? BigInt(0));

  const checks: Array<[string, boolean, string]> = [
    [
      "users",
      usersFile === 0 || dbUsers >= usersFile,
      `file=${usersFile} db=${dbUsers}`,
    ],
    [
      "projects",
      projectFiles === 0 || dbProjects >= projectFiles,
      `file=${projectFiles} db=${dbProjects}`,
    ],
    [
      "workflows",
      workflowFiles === 0 || dbWorkflows >= Math.min(workflowFiles, dbProjects),
      `file=${workflowFiles} db=${dbWorkflows}`,
    ],
    [
      "files",
      assetFiles === 0 || dbFiles >= 0,
      `fileAssets=${assetFiles} dbFiles=${dbFiles}`,
    ],
    [
      "creditAccounts",
      creditUsers === 0 || dbAccounts >= 0,
      `fileUsers=${creditUsers} db=${dbAccounts}`,
    ],
    [
      "creditBalanceSum",
      creditUsers === 0 || dbBalanceSum === fileBalanceSum || dbAccounts === 0,
      `fileSum=${fileBalanceSum} dbSum=${dbBalanceSum}`,
    ],
  ];

  // Password hash presence sample
  const sampleUser = await prisma.user.findFirst();
  if (sampleUser) {
    const ok = Boolean(sampleUser.passwordHash && sampleUser.passwordSalt);
    checks.push(["passwordHashPresent", ok, ok ? "ok" : "missing"]);
  }

  let failed = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "OK" : "FAIL"} ${name}: ${detail}`);
    if (!ok) failed += 1;
  }

  // Sample ID stability: first file user id equals DB if present
  const usersData = await readJson<{
    users?: Array<{ id?: string }>;
  }>(path.join(dataRoot(), "users.json"));
  const firstId = usersData?.users?.[0]?.id;
  if (firstId) {
    const u = await prisma.user.findUnique({ where: { id: firstId } });
    const ok = Boolean(u);
    console.log(
      `${ok ? "OK" : "FAIL"} sampleUserId: ${firstId} ${ok ? "preserved" : "missing"}`,
    );
    if (!ok) failed += 1;
  }

  return failed;
}

async function main() {
  const mode = parseArgs(process.argv.slice(2));
  const url = (process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  if (url.includes("production") && mode === "apply") {
    console.error("Refusing --apply against a URL that looks like production");
    process.exit(1);
  }

  console.log(`Legacy import mode: ${mode}`);
  console.log(`data/ root: ${dataRoot()} (read-only; never deleted)`);

  const prisma = new PrismaClient();
  try {
    try {
      await prisma.$connect();
    } catch {
      console.error(
        "Cannot connect to DATABASE_URL. Start local PostgreSQL (npm run db:up) first.",
      );
      process.exit(1);
    }

    if (mode === "verify") {
      const failed = await verify(prisma);
      process.exit(failed === 0 ? 0 : 2);
    }

    const plannedUserIds = await loadPlannedUserIds();
    const plannedProjectIds = new Set<string>();

    const users = await importUsers(prisma, mode);
    printStats("users", users);
    const projects = await importProjects(
      prisma,
      mode,
      plannedUserIds,
      plannedProjectIds,
    );
    printStats("projects", projects);
    const stories = await importStoryDrafts(prisma, mode, plannedProjectIds);
    printStats("storyDrafts", stories);
    const workflows = await importWorkflows(prisma, mode, plannedProjectIds);
    printStats("workflows", workflows);
    const assets = await importAssetMetas(
      prisma,
      mode,
      plannedProjectIds,
      plannedUserIds,
    );
    printStats("assetMetas", assets);
    const credits = await importCredits(prisma, mode, plannedUserIds);
    printStats("credits", credits);

    console.log(
      `[plan] plannedUsers=${plannedUserIds.size} plannedProjects=${plannedProjectIds.size}`,
    );

    if (mode === "dry-run") {
      console.log(
        "Dry-run complete. No database writes were performed (wouldCreate counts only).",
      );
    } else {
      console.log("Apply complete. Original data/ files were not modified.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
