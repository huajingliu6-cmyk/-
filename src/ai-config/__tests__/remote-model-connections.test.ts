import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StoredConnection = Record<string, unknown> & { id: string };
type ModelConnectionsFile = {
  schemaVersion: 1;
  connections: StoredConnection[];
  slotBindings: Record<string, string | null>;
};

const remoteState = vi.hoisted(() => ({
  file: null as ModelConnectionsFile | null,
}));

function applyDelta(
  current: ModelConnectionsFile,
  base: ModelConnectionsFile,
  desired: ModelConnectionsFile,
): ModelConnectionsFile {
  const baseConnections = new Map(
    base.connections.map((connection) => [connection.id, connection]),
  );
  const connections = new Map(
    current.connections.map((connection) => [connection.id, connection]),
  );
  for (const connection of desired.connections) {
    const original = baseConnections.get(connection.id);
    if (!original || JSON.stringify(original) !== JSON.stringify(connection)) {
      connections.set(connection.id, structuredClone(connection));
    }
  }
  const slotBindings = { ...current.slotBindings };
  const slots = new Set([
    ...Object.keys(base.slotBindings),
    ...Object.keys(desired.slotBindings),
  ]);
  for (const slot of slots) {
    if (base.slotBindings[slot] !== desired.slotBindings[slot]) {
      slotBindings[slot] = desired.slotBindings[slot] ?? null;
    }
  }
  return {
    schemaVersion: 1,
    connections: [...connections.values()],
    slotBindings,
  };
}

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (_path: string, init: RequestInit = {}) => {
    if ((init.method ?? "GET") === "GET") {
      return remoteState.file
        ? Response.json(structuredClone(remoteState.file))
        : Response.json({ error: "not found" }, { status: 404 });
    }
    const input = JSON.parse(String(init.body)) as {
      base: ModelConnectionsFile;
      desired: ModelConnectionsFile;
    };
    await Promise.resolve();
    remoteState.file = applyDelta(
      remoteState.file ?? {
        schemaVersion: 1,
        connections: [],
        slotBindings: {},
      },
      input.base,
      input.desired,
    );
    return Response.json(structuredClone(remoteState.file));
  }),
}));

import {
  bindSlot,
  createConnection,
  listConnectionsPublic,
  listSlotBindings,
  resolveConnectionForSlot,
} from "@/ai-config/model-connections";

describe("remote model connections", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-model-conn-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    process.env.AI_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
    remoteState.file = null;
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("stores encrypted secrets and exposes only masked public data", async () => {
    const created = await createConnection(
      {
        displayName: "Remote HTTP Text",
        modality: "text",
        providerMode: "http",
        baseUrl: "https://api.example.com/v1",
        modelId: "model-1",
        apiKey: "sk-remote-model-secret-123456",
      },
      "admin_1",
    );

    expect(
      remoteState.file?.connections.find((item) => item.id === created.id)?.apiKey,
    ).toMatch(/^enc:v1:/);
    const publicConnection = (await listConnectionsPublic()).find(
      (item) => item.id === created.id,
    );
    expect(publicConnection?.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(publicConnection)).not.toContain(
      "sk-remote-model-secret-123456",
    );
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("preserves concurrent connection creation and independent slot bindings", async () => {
    const [first, second] = await Promise.all([
      createConnection(
        {
          displayName: "Remote Text A",
          modality: "text",
          providerMode: "mock",
        },
        "admin_a",
      ),
      createConnection(
        {
          displayName: "Remote Text B",
          modality: "text",
          providerMode: "mock",
        },
        "admin_b",
      ),
    ]);

    await Promise.all([
      bindSlot("story-text", first.id, "admin_a"),
      bindSlot("script-outline-text", second.id, "admin_b"),
    ]);

    const realConnections = (await listConnectionsPublic()).filter(
      (connection) => !connection.legacyVirtual,
    );
    expect(realConnections.map((connection) => connection.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    const bindings = await listSlotBindings();
    expect(
      bindings.find((item) => item.profileSlot === "story-text")
        ?.modelConnectionId,
    ).toBe(first.id);
    expect(
      bindings.find((item) => item.profileSlot === "script-outline-text")
        ?.modelConnectionId,
    ).toBe(second.id);
    expect((await resolveConnectionForSlot("story-text")).id).toBe(first.id);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });
});