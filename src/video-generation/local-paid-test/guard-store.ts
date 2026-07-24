import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { LOCAL_PAID_TEST_GUARD_FILE_NAME } from "./constants";
import { LocalPaidTestError } from "./errors";
import type {
  LocalPaidTestGuardState,
  WanLocalPaidTestGuardRecord,
} from "./types";

export type WanLocalPaidTestGuardStore = {
  get(): Promise<WanLocalPaidTestGuardRecord>;
  arm(input: {
    requestFingerprint?: string | null;
  }): Promise<WanLocalPaidTestGuardRecord>;
  markSubmitting(input: {
    generationId: string;
    requestFingerprint?: string | null;
  }): Promise<WanLocalPaidTestGuardRecord>;
  markProviderAccepted(input: {
    generationId: string;
    providerTaskId: string;
  }): Promise<WanLocalPaidTestGuardRecord>;
  markTransferPending(input: {
    generationId: string;
    providerTaskId: string;
  }): Promise<WanLocalPaidTestGuardRecord>;
  markCompleted(input: {
    generationId: string;
    providerTaskId?: string | null;
  }): Promise<WanLocalPaidTestGuardRecord>;
  markFailedBeforeSubmit(input: {
    errorCode: string;
  }): Promise<WanLocalPaidTestGuardRecord>;
  markUnknownOutcome(input: {
    generationId?: string | null;
    errorCode: string;
  }): Promise<WanLocalPaidTestGuardRecord>;
  markConsumed(): Promise<WanLocalPaidTestGuardRecord>;
};

const GUARD_STATES: ReadonlySet<string> = new Set([
  "unarmed",
  "armed",
  "submitting",
  "providerAccepted",
  "transferPending",
  "completed",
  "failedBeforeSubmit",
  "unknownOutcome",
  "consumed",
]);

function defaultRecord(
  namespace: "live" | "simulation",
): WanLocalPaidTestGuardRecord {
  return {
    version: 1,
    state: "unarmed",
    generationId: null,
    providerTaskId: null,
    requestFingerprint: null,
    armedAt: null,
    updatedAt: new Date().toISOString(),
    lastErrorCode: null,
    simulation: namespace === "simulation",
    namespace,
  };
}

export function parseGuardRecord(raw: string): WanLocalPaidTestGuardRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1 || typeof obj.state !== "string") {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
  }
  if (!GUARD_STATES.has(obj.state)) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
  }
  // 拒绝敏感字段混入
  const forbidden = [
    "token",
    "apiKey",
    "dashscopeApiKey",
    "prompt",
    "authorization",
    "remoteVideoUrl",
    "base64",
  ];
  for (const key of forbidden) {
    if (key in obj) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
    }
  }

  return {
    version: 1,
    state: obj.state as LocalPaidTestGuardState,
    generationId:
      typeof obj.generationId === "string" || obj.generationId === null
        ? (obj.generationId as string | null)
        : null,
    providerTaskId:
      typeof obj.providerTaskId === "string" || obj.providerTaskId === null
        ? (obj.providerTaskId as string | null)
        : null,
    requestFingerprint:
      typeof obj.requestFingerprint === "string" ||
      obj.requestFingerprint === null
        ? (obj.requestFingerprint as string | null)
        : null,
    armedAt:
      typeof obj.armedAt === "string" || obj.armedAt === null
        ? (obj.armedAt as string | null)
        : null,
    updatedAt:
      typeof obj.updatedAt === "string"
        ? obj.updatedAt
        : new Date().toISOString(),
    lastErrorCode:
      typeof obj.lastErrorCode === "string" || obj.lastErrorCode === null
        ? (obj.lastErrorCode as string | null)
        : null,
    simulation: obj.simulation === true,
    namespace: obj.namespace === "simulation" ? "simulation" : "live",
  };
}

/**
 * 本地文件 Guard：单机器本机测试保护，不是生产预算系统。
 * Windows：目标已存在时 unlink→rename，有短暂缺失窗口，非 DB 事务。
 */
export class FileWanLocalPaidTestGuardStore
  implements WanLocalPaidTestGuardStore
{
  private readonly rootDir: string;
  private readonly namespace: "live" | "simulation";
  private readonly fileName: string;

  constructor(options?: {
    rootDir?: string;
    namespace?: "live" | "simulation";
  }) {
    this.namespace = options?.namespace ?? "live";
    this.rootDir =
      options?.rootDir ??
      path.join(process.cwd(), "data", "paid-test-guard");
    // 固定安全文件名，绝不来自用户输入
    this.fileName =
      this.namespace === "simulation"
        ? "simulation-one-shot-guard.json"
        : LOCAL_PAID_TEST_GUARD_FILE_NAME;
  }

  private resolvePath(): string {
    const resolved = path.resolve(this.rootDir, this.fileName);
    const rootResolved = path.resolve(this.rootDir);
    if (
      resolved !== path.join(rootResolved, this.fileName) &&
      !resolved.startsWith(rootResolved + path.sep)
    ) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
    }
    if (path.basename(resolved) !== this.fileName) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
    }
    return resolved;
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  private serialize(record: WanLocalPaidTestGuardRecord): string {
    // 明确只序列化安全字段
    const safe: WanLocalPaidTestGuardRecord = {
      version: 1,
      state: record.state,
      generationId: record.generationId,
      providerTaskId: record.providerTaskId,
      requestFingerprint: record.requestFingerprint,
      armedAt: record.armedAt,
      updatedAt: record.updatedAt,
      lastErrorCode: record.lastErrorCode,
      simulation: record.simulation,
      namespace: record.namespace,
    };
    return `${JSON.stringify(safe, null, 2)}\n`;
  }

  /**
   * 同目录临时文件写入后 rename。
   * Windows 目标已存在：unlink → rename（短暂缺失窗口）。
   */
  private async writeAtomic(record: WanLocalPaidTestGuardRecord): Promise<void> {
    await this.ensureDir();
    const target = this.resolvePath();
    const tmp = path.join(
      this.rootDir,
      `.${process.pid}-${randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(tmp, this.serialize(record), { encoding: "utf8" });
      try {
        await fs.rename(tmp, target);
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? (err as { code?: unknown }).code
            : undefined;
        if (code === "EPERM" || code === "EEXIST" || code === "EACCES") {
          await fs.unlink(target).catch(() => undefined);
          await fs.rename(tmp, target);
        } else {
          throw err;
        }
      }
    } catch (err) {
      await fs.unlink(tmp).catch(() => undefined);
      if (err instanceof LocalPaidTestError) throw err;
      throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_UNAVAILABLE");
    }
  }

  async get(): Promise<WanLocalPaidTestGuardRecord> {
    try {
      const raw = await fs.readFile(this.resolvePath(), "utf8");
      return parseGuardRecord(raw);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code?: unknown }).code
          : undefined;
      if (code === "ENOENT") {
        return defaultRecord(this.namespace);
      }
      if (err instanceof LocalPaidTestError) throw err;
      throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_UNAVAILABLE");
    }
  }

  async arm(input: {
    requestFingerprint?: string | null;
  }): Promise<WanLocalPaidTestGuardRecord> {
    const current = await this.get();
    if (
      current.state !== "unarmed" &&
      current.state !== "failedBeforeSubmit"
    ) {
      if (
        current.state === "submitting" ||
        current.state === "providerAccepted" ||
        current.state === "transferPending"
      ) {
        throw new LocalPaidTestError("LOCAL_PAID_TEST_ALREADY_IN_PROGRESS");
      }
      if (
        current.state === "completed" ||
        current.state === "consumed" ||
        current.state === "unknownOutcome" ||
        current.state === "armed"
      ) {
        if (current.state === "armed") {
          // 已 armed：返回当前，不调用 Provider
          return current;
        }
        if (current.state === "unknownOutcome") {
          throw new LocalPaidTestError("LOCAL_PAID_TEST_UNKNOWN_OUTCOME");
        }
        throw new LocalPaidTestError("LOCAL_PAID_TEST_ALREADY_CONSUMED");
      }
    }
    const now = new Date().toISOString();
    const next: WanLocalPaidTestGuardRecord = {
      ...current,
      state: "armed",
      generationId: null,
      providerTaskId: null,
      requestFingerprint: input.requestFingerprint ?? null,
      armedAt: now,
      updatedAt: now,
      lastErrorCode: null,
      simulation: this.namespace === "simulation",
      namespace: this.namespace,
    };
    await this.writeAtomic(next);
    return next;
  }

  async markSubmitting(input: {
    generationId: string;
    requestFingerprint?: string | null;
  }): Promise<WanLocalPaidTestGuardRecord> {
    const current = await this.get();
    if (current.state !== "armed") {
      if (
        current.state === "submitting" ||
        current.state === "providerAccepted" ||
        current.state === "transferPending"
      ) {
        throw new LocalPaidTestError("LOCAL_PAID_TEST_ALREADY_IN_PROGRESS");
      }
      if (current.state === "unknownOutcome") {
        throw new LocalPaidTestError("LOCAL_PAID_TEST_UNKNOWN_OUTCOME");
      }
      if (
        current.state === "completed" ||
        current.state === "consumed"
      ) {
        throw new LocalPaidTestError("LOCAL_PAID_TEST_ALREADY_CONSUMED");
      }
      throw new LocalPaidTestError("LOCAL_PAID_TEST_NOT_ARMED");
    }
    const next: WanLocalPaidTestGuardRecord = {
      ...current,
      state: "submitting",
      generationId: input.generationId,
      requestFingerprint:
        input.requestFingerprint ?? current.requestFingerprint,
      updatedAt: new Date().toISOString(),
      lastErrorCode: null,
    };
    await this.writeAtomic(next);
    return next;
  }

  async markProviderAccepted(input: {
    generationId: string;
    providerTaskId: string;
  }): Promise<WanLocalPaidTestGuardRecord> {
    if (!input.providerTaskId.trim()) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
    }
    const current = await this.get();
    if (
      current.state !== "submitting" &&
      current.state !== "providerAccepted"
    ) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
    }
    const next: WanLocalPaidTestGuardRecord = {
      ...current,
      state: "providerAccepted",
      generationId: input.generationId,
      providerTaskId: input.providerTaskId,
      updatedAt: new Date().toISOString(),
      lastErrorCode: null,
    };
    await this.writeAtomic(next);
    return next;
  }

  async markTransferPending(input: {
    generationId: string;
    providerTaskId: string;
  }): Promise<WanLocalPaidTestGuardRecord> {
    const current = await this.get();
    if (
      current.state !== "providerAccepted" &&
      current.state !== "transferPending"
    ) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
    }
    const next: WanLocalPaidTestGuardRecord = {
      ...current,
      state: "transferPending",
      generationId: input.generationId,
      providerTaskId: input.providerTaskId,
      updatedAt: new Date().toISOString(),
    };
    await this.writeAtomic(next);
    return next;
  }

  async markCompleted(input: {
    generationId: string;
    providerTaskId?: string | null;
  }): Promise<WanLocalPaidTestGuardRecord> {
    const current = await this.get();
    const next: WanLocalPaidTestGuardRecord = {
      ...current,
      state: "completed",
      generationId: input.generationId,
      providerTaskId: input.providerTaskId ?? current.providerTaskId,
      updatedAt: new Date().toISOString(),
      lastErrorCode: null,
    };
    await this.writeAtomic(next);
    return next;
  }

  async markFailedBeforeSubmit(input: {
    errorCode: string;
  }): Promise<WanLocalPaidTestGuardRecord> {
    const current = await this.get();
    if (
      current.state === "providerAccepted" ||
      current.state === "transferPending" ||
      current.state === "completed" ||
      current.state === "unknownOutcome" ||
      current.state === "consumed"
    ) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
    }
    const next: WanLocalPaidTestGuardRecord = {
      ...current,
      state: "failedBeforeSubmit",
      generationId: null,
      providerTaskId: null,
      updatedAt: new Date().toISOString(),
      lastErrorCode: input.errorCode,
    };
    await this.writeAtomic(next);
    return next;
  }

  async markUnknownOutcome(input: {
    generationId?: string | null;
    errorCode: string;
  }): Promise<WanLocalPaidTestGuardRecord> {
    const current = await this.get();
    if (current.state === "completed" || current.state === "consumed") {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_GUARD_CORRUPTED");
    }
    const next: WanLocalPaidTestGuardRecord = {
      ...current,
      state: "unknownOutcome",
      generationId: input.generationId ?? current.generationId,
      updatedAt: new Date().toISOString(),
      lastErrorCode: input.errorCode,
    };
    await this.writeAtomic(next);
    return next;
  }

  async markConsumed(): Promise<WanLocalPaidTestGuardRecord> {
    const current = await this.get();
    const next: WanLocalPaidTestGuardRecord = {
      ...current,
      state: "consumed",
      updatedAt: new Date().toISOString(),
    };
    await this.writeAtomic(next);
    return next;
  }
}
