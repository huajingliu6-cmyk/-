import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { GenerationRecord } from "./types";

const DIR = path.join(process.cwd(), "data", "generations");

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

export function assertSafeGenerationId(id: string): string {
  if (!SAFE_ID.test(id) || id.includes("..")) {
    throw new Error("无效的 generationId");
  }
  return id;
}

async function ensureDir() {
  await fs.mkdir(DIR, { recursive: true });
}

function filePath(id: string): string {
  return path.join(DIR, `${assertSafeGenerationId(id)}.json`);
}

export async function saveGenerationRecord(
  record: GenerationRecord,
): Promise<void> {
  await ensureDir();
  const target = filePath(record.id);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
  await fs.rename(tmp, target);
}

export async function readGenerationRecord(
  id: string,
): Promise<GenerationRecord | null> {
  try {
    const raw = await fs.readFile(filePath(id), "utf8");
    return JSON.parse(raw) as GenerationRecord;
  } catch {
    return null;
  }
}

export async function updateGenerationRecord(
  id: string,
  patch: Partial<GenerationRecord>,
): Promise<GenerationRecord> {
  const current = await readGenerationRecord(id);
  if (!current) throw new Error("生成任务不存在");
  const next: GenerationRecord = {
    ...current,
    ...patch,
    id: current.id,
    updatedAt: new Date().toISOString(),
  };
  await saveGenerationRecord(next);
  return next;
}

export function createGenerationId(): string {
  return randomUUID();
}

/** 短时间幂等：同一 key 最近提交过则返回已有记录 */
const recentKeys = new Map<string, { id: string; at: number }>();
const IDEMPOTENCY_MS = 8_000;

export function findIdempotentGeneration(
  key: string,
): string | null {
  const hit = recentKeys.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > IDEMPOTENCY_MS) {
    recentKeys.delete(key);
    return null;
  }
  return hit.id;
}

export function rememberIdempotencyKey(key: string, id: string): void {
  recentKeys.set(key, { id, at: Date.now() });
}

/** 仅测试用：清空短时幂等缓存，避免用例互相污染 */
export function clearIdempotencyKeysForTests(): void {
  recentKeys.clear();
}

/** 服务端轮询节流 */
const lastPollAt = new Map<string, number>();
const POLL_MIN_MS = 3_000;

export function shouldThrottlePoll(generationId: string): boolean {
  const last = lastPollAt.get(generationId) ?? 0;
  return Date.now() - last < POLL_MIN_MS;
}

export function markPolled(generationId: string): void {
  lastPollAt.set(generationId, Date.now());
}
