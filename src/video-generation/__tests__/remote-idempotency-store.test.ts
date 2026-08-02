import { createHash, randomUUID } from "crypto";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IdempotencyError } from "@/video-generation/idempotency/errors";
import { RemoteGenerationIdempotencyStore } from "@/video-generation/idempotency/remote-store";
import {
  getIdempotencyStore,
  setIdempotencyStoreForTests,
} from "@/video-generation/idempotency/store-registry";
import type {
  IdempotencyRecord,
  ReserveInput,
  ReserveOutcome,
} from "@/video-generation/idempotency/types";

type StoredDocument = { revision: number; value: unknown };
type Envelope = {
  version: 1;
  active: boolean;
  record: IdempotencyRecord | null;
  updatedAt: string;
};
type Index = { version: 1; recordKeys: string[]; updatedAt: string };

const documents = vi.hoisted(() => new Map<string, StoredDocument>());

function identity(namespace: string, key: string) {
  return `${namespace}/${key}`;
}

function recordKey(scope: string, key: string) {
  return createHash("sha256").update(`${scope}\0${key}`, "utf8").digest("hex");
}

function envelope(record: IdempotencyRecord | null): Envelope {
  return { version: 1, active: record !== null, record, updatedAt: new Date().toISOString() };
}

function parseEnvelope(value: unknown): IdempotencyRecord | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object") throw new Error("CORRUPTED");
  const parsed = value as Partial<Envelope>;
  if (parsed.version !== 1 || typeof parsed.active !== "boolean") throw new Error("CORRUPTED");
  if (!parsed.active && parsed.record === null) return null;
  const record = parsed.record as Partial<IdempotencyRecord> | undefined;
  if (
    !parsed.active ||
    !record ||
    typeof record.id !== "string" ||
    record.scope !== "video-generation" ||
    typeof record.idempotencyKey !== "string" ||
    typeof record.requestFingerprint !== "string" ||
    typeof record.generationId !== "string" ||
    typeof record.projectId !== "string" ||
    typeof record.shotNodeId !== "string" ||
    typeof record.providerId !== "string" ||
    typeof record.state !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.expiresAt !== "string"
  ) throw new Error("CORRUPTED");
  if ("prompt" in record) throw new Error("CORRUPTED");
  return structuredClone(record as IdempotencyRecord);
}

function errorResponse(code: string, status = 409) {
  return Response.json({ code, error: code }, { status });
}

function classify(record: IdempotencyRecord, input: ReserveInput): ReserveOutcome | Response {
  if (record.requestFingerprint !== input.requestFingerprint) {
    return errorResponse("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");
  }
  const kind = {
    committed: "existing",
    providerAccepted: "existing",
    reserved: "in_progress",
    submitting: "in_progress",
    safeFailure: "safe_retry",
    unknownOutcome: "blocked_unknown",
  }[record.state] as ReserveOutcome["kind"];
  return { kind, record } as ReserveOutcome;
}

async function reserve(input: ReserveInput): Promise<Response> {
  const key = recordKey(input.scope, input.idempotencyKey);
  const recordIdentity = identity("video-generation-idempotency", key);
  const indexIdentity = identity("video-generation-idempotency-index", "all");
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const recordDocument = structuredClone(documents.get(recordIdentity));
    const indexDocument = structuredClone(documents.get(indexIdentity));
    let existing: IdempotencyRecord | null;
    try {
      existing = parseEnvelope(recordDocument?.value);
    } catch {
      return errorResponse("IDEMPOTENCY_RECORD_CORRUPTED");
    }
    if (existing) {
      const outcome = classify(existing, input);
      return outcome instanceof Response ? outcome : Response.json(outcome);
    }
    const now = new Date();
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
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? 7 * 24 * 60 * 60 * 1000)).toISOString(),
      lastErrorCode: null,
    };
    const index = (indexDocument?.value as Index | undefined) ?? {
      version: 1,
      recordKeys: [],
      updatedAt: now.toISOString(),
    };
    await Promise.resolve();
    if (
      documents.get(recordIdentity)?.revision !== recordDocument?.revision ||
      documents.get(indexIdentity)?.revision !== indexDocument?.revision
    ) continue;
    documents.set(recordIdentity, {
      revision: (recordDocument?.revision ?? 0) + 1,
      value: envelope(record),
    });
    if (!index.recordKeys.includes(key)) {
      documents.set(indexIdentity, {
        revision: (indexDocument?.revision ?? 0) + 1,
        value: { ...index, recordKeys: [...index.recordKeys, key], updatedAt: now.toISOString() },
      });
    }
    return Response.json({ kind: "reserved", record });
  }
  return errorResponse("IDEMPOTENCY_STORE_UNAVAILABLE", 503);
}

async function updateRecord(
  scope: string,
  key: string,
  transform: (record: IdempotencyRecord) => IdempotencyRecord | Response,
): Promise<Response> {
  const documentIdentity = identity("video-generation-idempotency", recordKey(scope, key));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const document = structuredClone(documents.get(documentIdentity));
    let current: IdempotencyRecord | null;
    try {
      current = parseEnvelope(document?.value);
    } catch {
      return errorResponse("IDEMPOTENCY_RECORD_CORRUPTED");
    }
    if (!current) return errorResponse("IDEMPOTENCY_STORE_UNAVAILABLE", 503);
    const next = transform(current);
    if (next instanceof Response) return next;
    await Promise.resolve();
    if (documents.get(documentIdentity)?.revision !== document?.revision) continue;
    documents.set(documentIdentity, {
      revision: (document?.revision ?? 0) + 1,
      value: envelope(next),
    });
    return Response.json({ record: next });
  }
  return errorResponse("IDEMPOTENCY_STORE_UNAVAILABLE", 503);
}

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, "http://go-backend.internal");
    if ((init.method ?? "GET") === "GET") {
      if (url.searchParams.get("list") === "true") {
        const index = documents.get(identity("video-generation-idempotency-index", "all"))?.value as Index | undefined;
        const records = (index?.recordKeys ?? []).flatMap((key) => {
          try {
            const record = parseEnvelope(documents.get(identity("video-generation-idempotency", key))?.value);
            return record ? [record] : [];
          } catch {
            return [];
          }
        });
        return Response.json({ records });
      }
      const scope = url.searchParams.get("scope") ?? "";
      const key = url.searchParams.get("key") ?? "";
      try {
        const record = parseEnvelope(
          documents.get(identity("video-generation-idempotency", recordKey(scope, key)))?.value,
        );
        return Response.json({ record });
      } catch {
        return errorResponse("IDEMPOTENCY_RECORD_CORRUPTED");
      }
    }

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (body.action === "reserve") return reserve(body.input as ReserveInput);
    if (body.action === "reReserveAfterSafeFailure") {
      const input = body.input as ReserveInput;
      return updateRecord(input.scope, input.idempotencyKey, (current) => {
        if (current.state !== "safeFailure") return errorResponse("IDEMPOTENCY_RECORD_CORRUPTED");
        if (current.requestFingerprint !== input.requestFingerprint) {
          return errorResponse("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");
        }
        const now = new Date();
        return {
          ...current,
          generationId: input.generationId,
          state: "reserved",
          providerTaskId: null,
          updatedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + (input.ttlMs ?? 7 * 24 * 60 * 60 * 1000)).toISOString(),
          lastErrorCode: null,
        };
      });
    }
    const scope = String(body.scope ?? "");
    const key = String(body.key ?? "");
    const generationId = String(body.generationId ?? "");
    if (body.action === "releaseIfSafe") {
      const documentIdentity = identity("video-generation-idempotency", recordKey(scope, key));
      let current: IdempotencyRecord | null;
      try { current = parseEnvelope(documents.get(documentIdentity)?.value); }
      catch { return errorResponse("IDEMPOTENCY_RECORD_CORRUPTED"); }
      if (!current) return Response.json({ released: true });
      if (current.generationId !== generationId || !["reserved", "safeFailure"].includes(current.state)) {
        return Response.json({ released: false });
      }
      const document = documents.get(documentIdentity)!;
      documents.set(documentIdentity, { revision: document.revision + 1, value: envelope(null) });
      return Response.json({ released: true });
    }
    return updateRecord(scope, key, (current) => {
      if (current.generationId !== generationId) return errorResponse("IDEMPOTENCY_RECORD_CORRUPTED");
      const next = { ...current, updatedAt: new Date().toISOString() };
      switch (body.action) {
        case "markSubmitting":
          next.state = "submitting";
          next.lastErrorCode = null;
          break;
        case "markProviderAccepted":
          if (!String(body.providerTaskId ?? "").trim()) return errorResponse("IDEMPOTENCY_RECORD_CORRUPTED");
          next.state = "providerAccepted";
          next.providerTaskId = String(body.providerTaskId);
          next.lastErrorCode = null;
          break;
        case "markCommitted":
          next.state = "committed";
          break;
        case "markSafeFailure":
          if (["providerAccepted", "committed", "unknownOutcome"].includes(current.state)) {
            return errorResponse("IDEMPOTENCY_RECORD_CORRUPTED");
          }
          next.state = "safeFailure";
          next.lastErrorCode = String(body.errorCode ?? "");
          break;
        case "markUnknownOutcome":
          if (current.state === "committed") return errorResponse("IDEMPOTENCY_RECORD_CORRUPTED");
          next.state = "unknownOutcome";
          next.lastErrorCode = String(body.errorCode ?? "");
          break;
        default:
          return errorResponse("IDEMPOTENCY_RECORD_CORRUPTED");
      }
      return next;
    });
  }),
}));

function input(generationId: string, idempotencyKey = "idem_1"): ReserveInput {
  return {
    scope: "video-generation",
    idempotencyKey,
    requestFingerprint: "a".repeat(64),
    generationId,
    projectId: "project_1",
    shotNodeId: "shot_1",
    providerId: "mock",
  };
}

describe("remote video generation idempotency store", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-idem-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    documents.clear();
    setIdempotencyStoreForTests(null);
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    setIdempotencyStoreForTests(null);
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("selects the remote store in remote-data-only mode", () => {
    expect(getIdempotencyStore()).toBeInstanceOf(RemoteGenerationIdempotencyStore);
    expect(getIdempotencyStore().backendKind).toBe("postgres");
  });

  it("allows only one concurrent reservation for the same key", async () => {
    const outcomes = await Promise.all([
      new RemoteGenerationIdempotencyStore().reserve(input("generation_1")),
      new RemoteGenerationIdempotencyStore().reserve(input("generation_2")),
    ]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["in_progress", "reserved"]);
    expect(outcomes[0].record.generationId).toBe(outcomes[1].record.generationId);
    expect(await new RemoteGenerationIdempotencyStore().listAll()).toHaveLength(1);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("preserves the state machine and supports safe re-reservation", async () => {
    const store = new RemoteGenerationIdempotencyStore();
    await store.reserve(input("generation_1"));
    await store.markSafeFailure("video-generation", "idem_1", "generation_1", "VALIDATION_FAILED");
    expect((await store.reserve(input("generation_2"))).kind).toBe("safe_retry");
    const retried = await store.reReserveAfterSafeFailure(input("generation_2"));
    expect(retried).toMatchObject({ generationId: "generation_2", state: "reserved" });
    await store.markSubmitting("video-generation", "idem_1", "generation_2");
    await store.markProviderAccepted("video-generation", "idem_1", "generation_2", "provider_task_1");
    const committed = await store.markCommitted("video-generation", "idem_1", "generation_2");
    expect(committed).toMatchObject({ state: "committed", providerTaskId: "provider_task_1" });
    expect(await store.releaseIfSafe("video-generation", "idem_1", "generation_2")).toBe(false);
  });

  it("blocks unknown outcomes and rejects key reuse with another request", async () => {
    const store = new RemoteGenerationIdempotencyStore();
    await store.reserve(input("generation_1"));
    await store.markUnknownOutcome("video-generation", "idem_1", "generation_1", "GENERATION_SUBMISSION_UNKNOWN");
    expect((await store.reserve(input("generation_2"))).kind).toBe("blocked_unknown");
    await expect(store.reserve({ ...input("generation_3"), requestFingerprint: "b".repeat(64) }))
      .rejects.toMatchObject<Partial<IdempotencyError>>({ code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" });
  });

  it("safely releases a pre-provider record and reuses its indexed slot", async () => {
    const store = new RemoteGenerationIdempotencyStore();
    await store.reserve(input("generation_1"));
    expect(await store.releaseIfSafe("video-generation", "idem_1", "generation_1")).toBe(true);
    expect(await store.get("video-generation", "idem_1")).toBeNull();
    expect((await store.reserve(input("generation_2"))).kind).toBe("reserved");
    expect((await store.listAll()).map((record) => record.generationId)).toEqual(["generation_2"]);
    expect(documents.get("video-generation-idempotency-index/all")?.value).toMatchObject({ recordKeys: [expect.any(String)] });
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("refuses to overwrite a corrupted remote record", async () => {
    const store = new RemoteGenerationIdempotencyStore();
    await store.reserve(input("generation_1"));
    const recordDocument = [...documents.entries()].find(([key]) => key.startsWith("video-generation-idempotency/"));
    expect(recordDocument).toBeDefined();
    documents.set(recordDocument![0], {
      revision: recordDocument![1].revision + 1,
      value: { version: 1, active: true, record: { prompt: "unsafe" } },
    });
    await expect(store.reserve(input("generation_2"))).rejects.toMatchObject<Partial<IdempotencyError>>({
      code: "IDEMPOTENCY_RECORD_CORRUPTED",
    });
  });
});