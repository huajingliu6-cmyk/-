import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { GenerationRecord } from "./types";
import { clearIdempotencyStoreForTests } from "./idempotency";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  listGenerationRecordsRemote,
  readGenerationRecordRemote,
  saveGenerationRecordRemote,
  updateGenerationRecordRemote,
} from "./remote-generation-store";

function defaultGenerationsDir(): string {
  return resolveAppDataPath("generations");
}

type GenerationStoreGlobal = typeof globalThis & {
  __infiniteCanvasGenerationStoreRoot?: string;
};

function StoreGlobal(): GenerationStoreGlobal {
  return globalThis as GenerationStoreGlobal;
}

function getGenerationsDir(): string {
  return StoreGlobal().__infiniteCanvasGenerationStoreRoot ?? defaultGenerationsDir();
}

/** 测试可注入临时目录；传 null 恢复默认。正式路径禁止写测试数据。 */
export function setGenerationStoreRootForTests(root: string | null): void {
  const g = StoreGlobal();
  if (root === null) {
    delete g.__infiniteCanvasGenerationStoreRoot;
  } else {
    g.__infiniteCanvasGenerationStoreRoot = root;
  }
}

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

export function assertSafeGenerationId(id: string): string {
  if (!SAFE_ID.test(id) || id.includes("..")) {
    throw new Error("无效的 generationId");
  }
  return id;
}

async function ensureDir() {
  await fs.mkdir(getGenerationsDir(), { recursive: true });
}

function filePath(id: string): string {
  return path.join(getGenerationsDir(), `${assertSafeGenerationId(id)}.json`);
}


/** Windows 上 rename 不能覆盖已存在目标；先写临时文件再替换。 */
async function atomicWriteFile(target: string, contents: string): Promise<void> {
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, contents, "utf8");
  try {
    await fs.rename(tmp, target);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (code === "EPERM" || code === "EEXIST") {
      await fs.unlink(target).catch(() => undefined);
      await fs.rename(tmp, target);
      return;
    }
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export async function saveGenerationRecord(
  record: GenerationRecord,
): Promise<void> {
  assertSafeGenerationId(record.id);
  if (isRemoteDataOnly()) {
    await saveGenerationRecordRemote(record);
    return;
  }
  await ensureDir();
  await atomicWriteFile(filePath(record.id), JSON.stringify(record, null, 2));
}

export async function readGenerationRecord(
  id: string,
): Promise<GenerationRecord | null> {
  assertSafeGenerationId(id);
  if (isRemoteDataOnly()) return readGenerationRecordRemote(id);
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
  assertSafeGenerationId(id);
  if (isRemoteDataOnly()) return updateGenerationRecordRemote(id, patch);
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

/** 列出本地 generation 记录（单机开发扫描；非生产索引） */
export async function listGenerationRecords(): Promise<GenerationRecord[]> {
  if (isRemoteDataOnly()) return listGenerationRecordsRemote();
  await ensureDir();
  const names = await fs.readdir(getGenerationsDir());
  const out: GenerationRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.includes("..")) continue;
    const id = name.slice(0, -5);
    if (!SAFE_ID.test(id)) continue;
    const record = await readGenerationRecord(id);
    if (record) out.push(record);
  }
  return out;
}

/**
 * @deprecated 进程内 8 秒 Map 已移除；保留空实现以免旧测试 import 断裂。
 * 请使用持久化 idempotency store。
 */
export function findIdempotentGeneration(key: string): string | null {
  void key;
  return null;
}

/**
 * @deprecated 见持久化 GenerationIdempotencyStore.reserve
 */
export function rememberIdempotencyKey(key: string, id: string): void {
  void key;
  void id;
  // no-op：持久化路径在 service 中 reserve
}

/** 测试用：清空持久幂等目录（兼容旧名） */
export async function clearIdempotencyKeysForTests(): Promise<void> {
  await clearIdempotencyStoreForTests();
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
