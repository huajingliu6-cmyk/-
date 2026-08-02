import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const remoteFile = vi.hoisted(() => ({
  version: 2,
  configs: [] as Array<Record<string, unknown>>,
  bindings: [] as Array<Record<string, unknown>>,
  audit: [] as Array<Record<string, unknown>>,
}));

function mergeRecords(
  current: Array<Record<string, unknown>>,
  desired: Array<Record<string, unknown>>,
  key: string,
) {
  const records = new Map(current.map((record) => [String(record[key]), record]));
  for (const record of desired) {
    const identity = String(record[key]);
    const existing = records.get(identity);
    if (
      !existing ||
      String(record.updatedAt ?? "") >= String(existing.updatedAt ?? "")
    ) {
      records.set(identity, structuredClone(record));
    }
  }
  return [...records.values()];
}

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (_path: string, init: RequestInit = {}) => {
    if ((init.method ?? "GET") === "GET") {
      return Response.json(structuredClone(remoteFile));
    }
    const desired = JSON.parse(String(init.body)) as typeof remoteFile;
    await Promise.resolve();
    remoteFile.configs = mergeRecords(remoteFile.configs, desired.configs, "id");
    remoteFile.bindings = mergeRecords(
      remoteFile.bindings,
      desired.bindings,
      "capabilityId",
    );
    remoteFile.audit = mergeRecords(remoteFile.audit, desired.audit, "id")
      .sort((left, right) =>
        String(left.updatedAt).localeCompare(String(right.updatedAt)),
      )
      .slice(-200);
    return Response.json(structuredClone(remoteFile));
  }),
}));

import {
  getGenerationApiConfig,
  listConfigAuditEntries,
  updateGenerationApiConfig,
} from "@/auth/api-config";

describe("remote generation API config", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-api-config-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    process.env.AI_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    remoteFile.configs = [];
    remoteFile.bindings = [];
    remoteFile.audit = [];
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("stores encrypted secrets remotely without local files", async () => {
    await updateGenerationApiConfig(
      "character-image",
      { apiKey: "sk-remote-config-secret-123456" },
      "admin_1",
    );

    expect(
      remoteFile.configs.find((item) => item.id === "character-image")?.apiKey,
    ).toMatch(/^enc:v1:/);
    expect((await getGenerationApiConfig("character-image")).apiKey).toBe(
      "sk-remote-config-secret-123456",
    );
    expect((await listConfigAuditEntries())[0]?.updatedBy).toBe("admin_1");
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("preserves concurrent updates to different profile slots", async () => {
    await Promise.all([
      updateGenerationApiConfig(
        "character-image",
        { enabled: false },
        "admin_a",
      ),
      updateGenerationApiConfig("scene-image", { enabled: false }, "admin_b"),
    ]);

    expect((await getGenerationApiConfig("character-image")).enabled).toBe(false);
    expect((await getGenerationApiConfig("scene-image")).enabled).toBe(false);
    expect(
      (await listConfigAuditEntries()).map((entry) => entry.updatedBy).sort(),
    ).toEqual(["admin_a", "admin_b"]);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });
});