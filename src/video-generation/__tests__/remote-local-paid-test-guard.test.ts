import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WanLocalPaidTestGuardRecord } from "@/video-generation/local-paid-test/types";

type StoredDocument = { revision: number; value: WanLocalPaidTestGuardRecord };

const documents = vi.hoisted(() => new Map<string, StoredDocument>());

function defaultRecord(namespace: "live" | "simulation"): WanLocalPaidTestGuardRecord {
  return {
    version: 1,
    state: "unarmed",
    generationId: null,
    providerTaskId: null,
    requestFingerprint: null,
    armNonceHash: null,
    armedAt: null,
    updatedAt: new Date().toISOString(),
    lastErrorCode: null,
    simulation: namespace === "simulation",
    namespace,
  };
}

function errorResponse(code: string, status = 409) {
  return Response.json({ code, error: code }, { status });
}

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, "http://go-backend.internal");
    if ((init.method ?? "GET") === "GET") {
      const namespace = (url.searchParams.get("namespace") ?? "live") as
        | "live"
        | "simulation";
      return Response.json({
        record: structuredClone(documents.get(namespace)?.value ?? defaultRecord(namespace)),
      });
    }

    const body = JSON.parse(String(init.body)) as {
      action: string;
      namespace: "live" | "simulation";
      generationId?: string | null;
      requestFingerprint?: string | null;
      armNonceHash?: string;
    };
    const snapshot = structuredClone(documents.get(body.namespace));
    const current = snapshot?.value ?? defaultRecord(body.namespace);
    const next = structuredClone(current);
    const now = new Date().toISOString();

    if (body.action === "arm") {
      if (!body.armNonceHash?.trim()) {
        return errorResponse("LOCAL_PAID_TEST_GUARD_CORRUPTED");
      }
      if (!["unarmed", "failedBeforeSubmit", "armed"].includes(current.state)) {
        return errorResponse("LOCAL_PAID_TEST_ALREADY_IN_PROGRESS");
      }
      next.state = "armed";
      next.generationId = null;
      next.providerTaskId = null;
      next.requestFingerprint = body.requestFingerprint ?? null;
      next.armNonceHash = body.armNonceHash;
      next.armedAt = now;
      next.lastErrorCode = null;
    } else if (body.action === "markSubmitting") {
      if (current.state !== "armed") {
        return errorResponse("LOCAL_PAID_TEST_NOT_ARMED");
      }
      next.state = "submitting";
      next.generationId = body.generationId ?? null;
      next.requestFingerprint = body.requestFingerprint ?? current.requestFingerprint;
      next.lastErrorCode = null;
    } else {
      return errorResponse("LOCAL_PAID_TEST_GUARD_CORRUPTED");
    }
    next.updatedAt = now;

    await Promise.resolve();
    if (documents.get(body.namespace)?.revision !== snapshot?.revision) {
      return errorResponse("LOCAL_PAID_TEST_GUARD_UNAVAILABLE");
    }
    documents.set(body.namespace, {
      revision: (snapshot?.revision ?? 0) + 1,
      value: structuredClone(next),
    });
    return Response.json({ record: next });
  }),
}));

import { FileWanLocalPaidTestGuardStore } from "@/video-generation/local-paid-test/guard-store";
import { LocalPaidTestError } from "@/video-generation/local-paid-test/errors";

describe("remote local paid test guard", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-paid-guard-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    documents.clear();
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("persists safe one-shot state remotely without a guard file", async () => {
    const store = new FileWanLocalPaidTestGuardStore({ namespace: "live" });
    await store.arm({ armNonceHash: "nonce-hash", requestFingerprint: "fingerprint" });
    await store.markSubmitting({ generationId: "generation-1" });

    expect(documents.get("live")?.value).toMatchObject({
      state: "submitting",
      generationId: "generation-1",
      armNonceHash: "nonce-hash",
    });
    expect(JSON.stringify(documents.get("live")?.value)).not.toMatch(/armNonce\s*:/);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("rejects stale concurrent state writes instead of overwriting the guard", async () => {
    const first = new FileWanLocalPaidTestGuardStore({ namespace: "live" });
    const second = new FileWanLocalPaidTestGuardStore({ namespace: "live" });
    const results = await Promise.allSettled([
      first.arm({ armNonceHash: "first" }),
      second.arm({ armNonceHash: "second" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(LocalPaidTestError);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });
});