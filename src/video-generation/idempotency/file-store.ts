import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  IdempotencyError,
} from "./errors";
import { IDEMPOTENCY_RECORD_TTL_MS } from "./constants";
import type {
  GenerationIdempotencyStore,
  IdempotencyRecord,
  IdempotencyScope,
  IdempotencyState,
  ReserveInput,
  ReserveOutcome,
} from "./types";
import { resolveAppDataPath } from "@/persistence/data-root";

const SAFE_HEX = /^[a-f0-9]{64}$/;

/**
 * 本地开发幂等后端：单机器共享文件系统。
 * 不宣称支持多机器并发；生产请实现 Postgres/Redis 版同一接口。
 */
export class FileGenerationIdempotencyStore
  implements GenerationIdempotencyStore
{
  readonly backendKind = "file-local" as const;
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? resolveAppDataPath("idempotency");
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  /** key 不得直接作路径；用 sha256 防穿越与特殊字符 */
  fileNameFor(scope: IdempotencyScope, key: string): string {
    const digest = createHash("sha256")
      .update(`${scope}\0${key}`, "utf8")
      .digest("hex");
    if (!SAFE_HEX.test(digest)) {
      throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
    }
    return `${digest}.json`;
  }

  private resolvePath(scope: IdempotencyScope, key: string): string {
    const name = this.fileNameFor(scope, key);
    const resolved = path.resolve(this.rootDir, name);
    const rootResolved = path.resolve(this.rootDir);
    if (
      resolved !== rootResolved &&
      !resolved.startsWith(rootResolved + path.sep)
    ) {
      throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
    }
    return resolved;
  }

  async get(
    scope: IdempotencyScope,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    try {
      const raw = await fs.readFile(this.resolvePath(scope, key), "utf8");
      return parseIdempotencyRecord(raw);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code?: unknown }).code
          : undefined;
      if (code === "ENOENT") return null;
      if (err instanceof IdempotencyError) throw err;
      throw new IdempotencyError("IDEMPOTENCY_STORE_UNAVAILABLE");
    }
  }

  async reserve(input: ReserveInput): Promise<ReserveOutcome> {
    await this.ensureDir();
    const existing = await this.get(input.scope, input.idempotencyKey);
    if (existing) {
      return this.classifyExisting(existing, input);
    }

    const now = new Date();
    const ttl = input.ttlMs ?? IDEMPOTENCY_RECORD_TTL_MS;
    const record: IdempotencyRecord = {
      id: randomUUID(),
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      generationId: input.generationId,
      projectId: input.projectId,
      shotNodeId: input.shotNodeId,
      providerId: input.providerId,
      state: "reserved",
      providerTaskId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl).toISOString(),
      lastErrorCode: null,
    };

    const target = this.resolvePath(input.scope, input.idempotencyKey);
    try {
      // 原子创建：同进程/同文件系统并发预留下仅一个成功
      await fs.writeFile(target, serializeRecord(record), {
        encoding: "utf8",
        flag: "wx",
      });
      return { kind: "reserved", record };
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code?: unknown }).code
          : undefined;
      if (code === "EEXIST") {
        const raced = await this.get(input.scope, input.idempotencyKey);
        if (!raced) {
          throw new IdempotencyError("IDEMPOTENCY_STORE_UNAVAILABLE");
        }
        return this.classifyExisting(raced, input);
      }
      throw new IdempotencyError("IDEMPOTENCY_STORE_UNAVAILABLE");
    }
  }

  private classifyExisting(
    existing: IdempotencyRecord,
    input: ReserveInput,
  ): ReserveOutcome {
    if (isExpired(existing) && canExpireAway(existing.state)) {
      // 过期且可清理：删除后由调用方再次 reserve（此处同步删）
      // 注意：committed 过期仍保留语义上应拒绝盲目删除计费关联；
      // 仅 safeFailure / reserved 空转允许清掉。
    }
    if (existing.requestFingerprint !== input.requestFingerprint) {
      throw new IdempotencyError(
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      );
    }
    switch (existing.state) {
      case "committed":
      case "providerAccepted":
        return { kind: "existing", record: existing };
      case "reserved":
      case "submitting":
        return { kind: "in_progress", record: existing };
      case "safeFailure":
        return { kind: "safe_retry", record: existing };
      case "unknownOutcome":
        return { kind: "blocked_unknown", record: existing };
      default: {
        const _exhaustive: never = existing.state;
        void _exhaustive;
        throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
      }
    }
  }

  /**
   * safeFailure 后同 key 同 fingerprint 允许覆盖为新的 reserved。
   */
  async reReserveAfterSafeFailure(
    input: ReserveInput,
  ): Promise<IdempotencyRecord> {
    const existing = await this.get(input.scope, input.idempotencyKey);
    if (!existing || existing.state !== "safeFailure") {
      throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
    }
    if (existing.requestFingerprint !== input.requestFingerprint) {
      throw new IdempotencyError(
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      );
    }
    const now = new Date();
    const ttl = input.ttlMs ?? IDEMPOTENCY_RECORD_TTL_MS;
    const next: IdempotencyRecord = {
      ...existing,
      generationId: input.generationId,
      state: "reserved",
      providerTaskId: null,
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl).toISOString(),
      lastErrorCode: null,
    };
    await this.writeAtomic(input.scope, input.idempotencyKey, next);
    return next;
  }

  async markSubmitting(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
  ): Promise<IdempotencyRecord> {
    return this.updateState(scope, key, generationId, (current) => ({
      ...current,
      state: "submitting",
      updatedAt: new Date().toISOString(),
      lastErrorCode: null,
    }));
  }

  async markProviderAccepted(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
    providerTaskId: string,
  ): Promise<IdempotencyRecord> {
    if (!providerTaskId.trim()) {
      throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
    }
    return this.updateState(scope, key, generationId, (current) => ({
      ...current,
      state: "providerAccepted",
      providerTaskId,
      updatedAt: new Date().toISOString(),
      lastErrorCode: null,
    }));
  }

  async markCommitted(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
  ): Promise<IdempotencyRecord> {
    return this.updateState(scope, key, generationId, (current) => ({
      ...current,
      state: "committed",
      updatedAt: new Date().toISOString(),
    }));
  }

  async markSafeFailure(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
    errorCode: string,
  ): Promise<IdempotencyRecord> {
    return this.updateState(scope, key, generationId, (current) => {
      if (
        current.state === "providerAccepted" ||
        current.state === "committed" ||
        current.state === "unknownOutcome"
      ) {
        throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
      }
      return {
        ...current,
        state: "safeFailure",
        updatedAt: new Date().toISOString(),
        lastErrorCode: errorCode,
      };
    });
  }

  async markUnknownOutcome(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
    errorCode: string,
  ): Promise<IdempotencyRecord> {
    return this.updateState(scope, key, generationId, (current) => {
      if (current.state === "committed") {
        throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
      }
      return {
        ...current,
        state: "unknownOutcome",
        updatedAt: new Date().toISOString(),
        lastErrorCode: errorCode,
      };
    });
  }

  async releaseIfSafe(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
  ): Promise<boolean> {
    const current = await this.get(scope, key);
    if (!current) return true;
    if (current.generationId !== generationId) return false;
    if (
      current.state === "safeFailure" ||
      current.state === "reserved"
    ) {
      await fs.unlink(this.resolvePath(scope, key)).catch(() => undefined);
      return true;
    }
    // Provider 已调用或未知结果：禁止删除
    return false;
  }

  private async updateState(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
    map: (current: IdempotencyRecord) => IdempotencyRecord,
  ): Promise<IdempotencyRecord> {
    const current = await this.get(scope, key);
    if (!current) {
      throw new IdempotencyError("IDEMPOTENCY_STORE_UNAVAILABLE");
    }
    if (current.generationId !== generationId) {
      throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
    }
    const next = map(current);
    await this.writeAtomic(scope, key, next);
    return next;
  }

  private async writeAtomic(
    scope: IdempotencyScope,
    key: string,
    record: IdempotencyRecord,
  ): Promise<void> {
    await this.ensureDir();
    const target = this.resolvePath(scope, key);
    const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, serializeRecord(record), "utf8");
      try {
        await fs.rename(tmp, target);
      } catch (renameErr) {
        const code =
          renameErr && typeof renameErr === "object" && "code" in renameErr
            ? (renameErr as { code?: unknown }).code
            : undefined;
        if (code === "EPERM" || code === "EEXIST") {
          await fs.unlink(target).catch(() => undefined);
          await fs.rename(tmp, target);
        } else {
          throw renameErr;
        }
      }
    } catch (err) {
      await fs.unlink(tmp).catch(() => undefined);
      if (err instanceof IdempotencyError) throw err;
      throw new IdempotencyError("IDEMPOTENCY_STORE_UNAVAILABLE");
    }
  }

  /** 扫描全部记录（本地对账 / 同镜头保护）；生产应换索引查询 */
  async listAll(): Promise<IdempotencyRecord[]> {
    await this.ensureDir();
    const names = await fs.readdir(this.rootDir);
    const out: IdempotencyRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      if (!SAFE_HEX.test(name.slice(0, -5))) continue;
      try {
        const raw = await fs.readFile(path.join(this.rootDir, name), "utf8");
        out.push(parseIdempotencyRecord(raw));
      } catch {
        // 跳过损坏文件；读取单条 get 时仍会抛结构化错误
      }
    }
    return out;
  }

  async clearAllForTests(): Promise<void> {
    await this.ensureDir();
    const names = await fs.readdir(this.rootDir);
    await Promise.all(
      names
        .filter((n) => n.endsWith(".json") || n.endsWith(".tmp"))
        .map((n) =>
          fs.unlink(path.join(this.rootDir, n)).catch(() => undefined),
        ),
    );
  }

  getRootDirForTests(): string {
    return this.rootDir;
  }
}

function serializeRecord(record: IdempotencyRecord): string {
  // 明确字段顺序，避免意外写入敏感字段
  const safe: IdempotencyRecord = {
    id: record.id,
    scope: record.scope,
    idempotencyKey: record.idempotencyKey,
    requestFingerprint: record.requestFingerprint,
    generationId: record.generationId,
    projectId: record.projectId,
    shotNodeId: record.shotNodeId,
    providerId: record.providerId,
    state: record.state,
    providerTaskId: record.providerTaskId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    lastErrorCode: record.lastErrorCode,
  };
  return `${JSON.stringify(safe, null, 2)}\n`;
}

export function parseIdempotencyRecord(raw: string): IdempotencyRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
  }
  const o = parsed as Record<string, unknown>;
  const states: IdempotencyState[] = [
    "reserved",
    "submitting",
    "providerAccepted",
    "committed",
    "safeFailure",
    "unknownOutcome",
  ];
  if (
    typeof o.id !== "string" ||
    o.scope !== "video-generation" ||
    typeof o.idempotencyKey !== "string" ||
    typeof o.requestFingerprint !== "string" ||
    typeof o.generationId !== "string" ||
    typeof o.projectId !== "string" ||
    typeof o.shotNodeId !== "string" ||
    typeof o.providerId !== "string" ||
    typeof o.state !== "string" ||
    !states.includes(o.state as IdempotencyState) ||
    (o.providerTaskId !== null && typeof o.providerTaskId !== "string") ||
    typeof o.createdAt !== "string" ||
    typeof o.updatedAt !== "string" ||
    typeof o.expiresAt !== "string" ||
    (o.lastErrorCode !== null && typeof o.lastErrorCode !== "string")
  ) {
    throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
  }
  // 拒绝意外敏感字段混入（防御）
  const banned = [
    "prompt",
    "apiKey",
    "api_key",
    "base64",
    "remoteVideoUrl",
    "authorization",
    "DASHSCOPE_API_KEY",
  ];
  for (const key of banned) {
    if (key in o) {
      throw new IdempotencyError("IDEMPOTENCY_RECORD_CORRUPTED");
    }
  }
  return {
    id: o.id,
    scope: "video-generation",
    idempotencyKey: o.idempotencyKey,
    requestFingerprint: o.requestFingerprint,
    generationId: o.generationId,
    projectId: o.projectId,
    shotNodeId: o.shotNodeId,
    providerId: o.providerId,
    state: o.state as IdempotencyState,
    providerTaskId: o.providerTaskId as string | null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    expiresAt: o.expiresAt,
    lastErrorCode: o.lastErrorCode as string | null,
  };
}

function isExpired(record: IdempotencyRecord): boolean {
  const exp = Date.parse(record.expiresAt);
  return Number.isFinite(exp) && Date.now() > exp;
}

function canExpireAway(state: IdempotencyState): boolean {
  return state === "safeFailure" || state === "reserved";
}
