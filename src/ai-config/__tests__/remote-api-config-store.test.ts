import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ApiConfigFile = {
  version: number;
  configs: Array<Record<string, unknown>>;
  bindings: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
};

const state = vi.hoisted(() => ({
  file: { version: 2, configs: [], bindings: [], audit: [] } as ApiConfigFile,
}));

function mergeRecords(
  current: Array<Record<string, unknown>>,
  desired: Array<Record<string, unknown>>,
  identityKey: string,
) {
  const merged = new Map<string, Record<string, unknown>>();
  for (const record of current) {
    const identity = String(record[identityKey] ?? "");
    if (identity) merged.set(identity, structuredClone(record));
  }
  for (const record of desired) {
    const identity = String(record[identityKey] ?? "");
    if (!identity) continue;
    const existing = merged.get(identity);
    const desiredUpdatedAt = String(record.updatedAt ?? "");
    const currentUpdatedAt = String(existing?.updatedAt ?? "");
    if (!existing || desiredUpdatedAt >= currentUpdatedAt) {
      merged.set(identity, structuredClone(record));
    }
  }
  return [...merged.values()];
}

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init?: RequestInit) => {
    if (requestPath !== "/v1/generation-api-configs") {
      return new Response(null, { status: 404 });
    }
    if ((init?.method ?? "GET") === "GET") {
      return Response.json(structuredClone(state.file));
    }
    const desired = JSON.parse(String(init?.body ?? "{}")) as ApiConfigFile;
    state.file = {
      version: 2,
      configs: mergeRecords(state.file.configs, desired.configs ?? [], "id"),
      bindings: mergeRecords(
        state.file.bindings,
        desired.bindings ?? [],
        "capabilityId",
      ),
      audit: mergeRecords(state.file.audit, desired.audit ?? [], "id").slice(-200),
    };
    return Response.json(structuredClone(state.file));
  }),
}));

import {
  getCapabilityBinding,
  getGenerationApiConfig,
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "@/auth/api-config";

describe("remote generation API config store", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-api-config-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    process.env.TEXT_LLM_PROVIDER = "mock";
    process.env.AI_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    state.file = { version: 2, configs: [], bindings: [], audit: [] };
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    delete process.env.TEXT_LLM_PROVIDER;
    delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("stores encrypted credentials remotely without local files", async () => {
    await updateGenerationApiConfig(
      "story-text",
      {
        provider: "mock",
        model: "remote-story-model",
        apiKey: "sk-remote-secret-key-123456",
      },
      "admin",
    );

    const story = state.file.configs.find((config) => config.id === "story-text");
    expect(String(story?.apiKey).startsWith("enc:v1:")).toBe(true);
    expect(JSON.stringify(state.file)).not.toContain("sk-remote-secret-key-123456");
    expect((await getGenerationApiConfig("story-text")).apiKey).toBe(
      "sk-remote-secret-key-123456",
    );
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("merges concurrent updates to different profile slots", async () => {
    await Promise.all([
      updateGenerationApiConfig(
        "story-text",
        { provider: "mock", model: "story-concurrent" },
        "admin-a",
      ),
      updateGenerationApiConfig(
        "script-outline-text",
        { provider: "mock", model: "outline-concurrent" },
        "admin-b",
      ),
    ]);

    expect((await getGenerationApiConfig("story-text")).model).toBe(
      "story-concurrent",
    );
    expect((await getGenerationApiConfig("script-outline-text")).model).toBe(
      "outline-concurrent",
    );
  });

  it("persists bindings and keeps planned capabilities disabled", async () => {
    await updateCapabilityBinding(
      "script.outline.generate",
      { profileSlotId: "story-text", enabled: true },
      "admin",
    );
    expect(await getCapabilityBinding("script.outline.generate")).toMatchObject({
      profileSlotId: "story-text",
      enabled: true,
    });

    await expect(
      updateCapabilityBinding(
        "script.episodes.generate",
        { enabled: true },
        "admin",
      ),
    ).rejects.toThrow();
  });
});
