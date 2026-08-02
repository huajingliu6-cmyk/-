/**
 * LegacyFileRepository — JSON/fs project store under data/projects.
 * Runtime default while PERSISTENCE_DRIVER=file (Batch A).
 * New PostgreSQL code lives in src/persistence/; do not extend this as the long-term store.
 */
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { hashPassword } from "@/auth/password";
import type {
  CreateProjectInput,
  ProjectPublic,
  ProjectRecord,
} from "@/projects/types";
import { LEGACY_FILE_REPOSITORY_NOTE } from "@/persistence/legacy/LegacyFileRepository";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  ProjectNameConflictError,
  ProjectNotFoundError,
} from "@/projects/project-errors";

export {
  ProjectNameConflictError,
  ProjectNotFoundError,
} from "@/projects/project-errors";

void LEGACY_FILE_REPOSITORY_NOTE;

function dataDir(): string {
  return resolveAppDataPath("projects");
}

async function ensureDir() {
  await fs.mkdir(dataDir(), { recursive: true });
}

function metaFilePath(projectId: string): string {
  return path.join(dataDir(), `${projectId}.json`);
}

/** 项目根文件夹目录（与项目 ID 同名；不另建第二实体） */
export function projectRootDir(projectId: string): string {
  return path.join(dataDir(), projectId);
}

function toPublic(record: ProjectRecord): ProjectPublic {
  return {
    projectId: record.projectId,
    rootFolderId: record.rootFolderId,
    name: record.name,
    ownerId: record.ownerId,
    creationSource: record.creationSource,
    projectMode: record.projectMode,
    status: record.status,
    highlights: record.highlights,
    passwordEnabled: record.passwordEnabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeRecord(raw: unknown): ProjectRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ProjectRecord>;
  if (
    typeof r.projectId !== "string" ||
    typeof r.name !== "string" ||
    typeof r.ownerId !== "string"
  ) {
    return null;
  }
  return {
    projectId: r.projectId,
    rootFolderId:
      typeof r.rootFolderId === "string" ? r.rootFolderId : r.projectId,
    name: r.name,
    ownerId: r.ownerId,
    creationSource:
      r.creationSource === "script-upload" ? "script-upload" : "story",
    projectMode: r.projectMode === "full-stack" ? "full-stack" : "canvas",
    status: "draft",
    highlights: typeof r.highlights === "string" ? r.highlights : "",
    passwordEnabled: Boolean(r.passwordEnabled),
    passwordHash:
      typeof r.passwordHash === "string" ? r.passwordHash : null,
    passwordSalt:
      typeof r.passwordSalt === "string" ? r.passwordSalt : null,
    createdAt:
      typeof r.createdAt === "string"
        ? r.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof r.updatedAt === "string"
        ? r.updatedAt
        : new Date().toISOString(),
  };
}

async function ensureRootFolder(projectId: string): Promise<void> {
  const dir = projectRootDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const marker = path.join(dir, ".root");
  try {
    await fs.access(marker);
  } catch {
    await fs.writeFile(
      marker,
      JSON.stringify(
        { projectId, rootFolderId: projectId, kind: "project-root" },
        null,
        2,
      ),
      "utf-8",
    );
  }
  await fs.mkdir(path.join(dir, "documents"), { recursive: true });
  await fs.mkdir(path.join(dir, "drafts"), { recursive: true });
}

export async function getProjectRecord(
  projectId: string,
): Promise<ProjectRecord | null> {
  await ensureDir();
  try {
    const raw = await fs.readFile(metaFilePath(projectId), "utf-8");
    return normalizeRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function getProjectPublic(
  projectId: string,
): Promise<ProjectPublic | null> {
  const record = await getProjectRecord(projectId);
  return record ? toPublic(record) : null;
}

export async function listProjectRecords(): Promise<ProjectRecord[]> {
  await ensureDir();
  const dir = dataDir();
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const list: ProjectRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (entry.name.includes(".tmp")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, entry.name), "utf-8");
      const parsed = normalizeRecord(JSON.parse(raw));
      if (parsed) list.push(parsed);
    } catch {
      // skip
    }
  }
  return list;
}

export async function findProjectByName(
  name: string,
): Promise<ProjectRecord | null> {
  const trimmed = name.trim();
  const all = await listProjectRecords();
  return all.find((p) => p.name === trimmed) ?? null;
}

/**
 * 原子创建：项目元数据 + 根文件夹（同 ID）。
 * 文件系统无跨文件事务；先写文件夹与 marker，再写元数据；失败时尽力回滚。
 */
export async function createProjectRecord(
  ownerId: string,
  input: CreateProjectInput,
): Promise<ProjectPublic> {
  await ensureDir();

  const existing = await findProjectByName(input.name);
  if (existing) {
    throw new ProjectNameConflictError();
  }

  const projectId = `p_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();

  let passwordHash: string | null = null;
  let passwordSalt: string | null = null;
  if (input.passwordEnabled) {
    const password = (input.projectPassword ?? "").trim();
    if (!password) {
      throw new Error("已启用项目密码，请填写项目访问密码");
    }
    const hashed = hashPassword(password);
    passwordHash = hashed.hash;
    passwordSalt = hashed.salt;
  }

  const record: ProjectRecord = {
    projectId,
    rootFolderId: projectId,
    name: input.name.trim(),
    ownerId,
    creationSource: input.creationSource,
    projectMode: input.projectMode,
    status: "draft",
    highlights: (input.highlights ?? "").trim(),
    passwordEnabled: input.passwordEnabled,
    passwordHash,
    passwordSalt,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await ensureRootFolder(projectId);
    const target = metaFilePath(projectId);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(record, null, 2), "utf-8");
    await fs.rename(temp, target);
  } catch (error) {
    // 尽力清理半创建状态
    try {
      await fs.rm(projectRootDir(projectId), { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      await fs.unlink(metaFilePath(projectId));
    } catch {
      // ignore
    }
    throw error;
  }

  return toPublic(record);
}

export async function updateProjectHighlights(
  projectId: string,
  highlights: string,
): Promise<ProjectPublic> {
  const record = await getProjectRecord(projectId);
  if (!record) {
    throw new ProjectNotFoundError();
  }
  const next: ProjectRecord = {
    ...record,
    highlights: highlights.trim(),
    updatedAt: new Date().toISOString(),
  };
  const target = metaFilePath(projectId);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(next, null, 2), "utf-8");
  await fs.rename(temp, target);
  return toPublic(next);
}

export async function getProjectNameMap(): Promise<Map<string, string>> {
  const records = await listProjectRecords();
  return new Map(records.map((r) => [r.projectId, r.name]));
}

