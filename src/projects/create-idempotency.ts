import { promises as fs } from "fs";
import path from "path";
import type { ProjectPublic } from "@/projects/types";
import { resolveAppDataPath } from "@/persistence/data-root";

function dir(): string {
  return resolveAppDataPath("project-create-idempotency");
}

type Entry = {
  key: string;
  userId: string;
  project: ProjectPublic;
  createdAt: string;
};

async function ensureDir() {
  await fs.mkdir(dir(), { recursive: true });
}

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "k";
}

function fileFor(key: string): string {
  return path.join(dir(), `${safeKey(key)}.json`);
}

export async function getCreateIdempotency(
  key: string,
  userId: string,
): Promise<ProjectPublic | null> {
  if (!key.trim()) return null;
  await ensureDir();
  try {
    const raw = await fs.readFile(fileFor(key), "utf-8");
    const entry = JSON.parse(raw) as Entry;
    if (entry.userId !== userId) return null;
    return entry.project;
  } catch {
    return null;
  }
}

export async function saveCreateIdempotency(
  key: string,
  userId: string,
  project: ProjectPublic,
): Promise<void> {
  if (!key.trim()) return;
  await ensureDir();
  const entry: Entry = {
    key,
    userId,
    project,
    createdAt: new Date().toISOString(),
  };
  const target = fileFor(key);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(entry, null, 2), "utf-8");
  await fs.rename(temp, target);
}
