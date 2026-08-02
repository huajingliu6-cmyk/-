import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  bindSlot,
  createConnection,
  listConnectionsPublic,
  listSlotBindings,
  resolveConnectionForSlot,
  updateConnection,
} from "@/ai-config/model-connections";
import {
  updateGenerationApiConfig,
  updateCapabilityBinding,
  getGenerationApiConfig,
} from "@/auth/api-config";

describe("model-connections", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-model-conn-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.TEXT_LLM_PROVIDER = "mock";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("lists virtual legacy connections without creating file", async () => {
    const connections = await listConnectionsPublic();
    const legacy = connections.find((c) => c.id === "legacy-slot-story-text");
    expect(legacy).toBeTruthy();
    expect(legacy!.legacyVirtual).toBe(true);
    expect(existsSync(path.join(tmp, "ai-model-connections.json"))).toBe(false);
    expect(JSON.stringify(connections)).not.toMatch(/sk-/);
  });

  it("createConnection writes file and hides apiKey in public list", async () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const created = await createConnection(
      {
        displayName: "Mock 文本",
        modality: "text",
        providerMode: "mock",
        enabled: true,
      },
      "admin1",
    );
    expect(created.id).toMatch(/^mc_/);
    expect(created.apiKeyConfigured).toBe(false);
    expect(existsSync(path.join(tmp, "ai-model-connections.json"))).toBe(true);
  });

  it("bindSlot resolves connection for profile slot", async () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const conn = await createConnection(
      {
        displayName: "Split Mock",
        modality: "text",
        providerMode: "mock",
      },
      "admin1",
    );
    await bindSlot("script-split-text", conn.id, "admin1");
    const bindings = await listSlotBindings();
    expect(
      bindings.find((b) => b.profileSlot === "script-split-text")?.modelConnectionId,
    ).toBe(conn.id);
    const resolved = await resolveConnectionForSlot("script-split-text");
    expect(resolved.id).toBe(conn.id);
  });

  it("falls back to legacy slot config when binding missing", async () => {
    await updateGenerationApiConfig("story-text", {
      provider: "mock",
      model: "legacy-story",
    });
    await updateCapabilityBinding(
      "story.generate",
      { profileSlotId: "story-text", enabled: true },
      "admin1",
    );
    const resolved = await resolveConnectionForSlot("story-text");
    expect(resolved.id).toBe("legacy-slot-story-text");
    expect(resolved.modelId).toBe("legacy-story");
  });

  it("keeps legacy virtual connections resolvable after slotBindings file exists", async () => {
    await updateGenerationApiConfig("script-split-text", {
      provider: "mock",
      model: "mock-split",
    });
    await bindSlot("script-split-text", "legacy-slot-script-split-text", "admin1");
    const listed = await listConnectionsPublic();
    // 本地分集后，智能分集模型不再出现在管理后台列表
    expect(listed.some((c) => c.id === "legacy-slot-script-split-text")).toBe(
      false,
    );
    const resolved = await resolveConnectionForSlot("script-split-text");
    expect(resolved.id).toBe("legacy-slot-script-split-text");
    expect(resolved.providerMode).toBe("mock");
  });

  it("updateConnection on legacy virtual writes through to profile slot", async () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    await updateGenerationApiConfig("script-split-text", {
      provider: "mock",
      model: "before-model",
    });
    const updated = await updateConnection(
      "legacy-slot-script-split-text",
      {
        providerMode: "mock",
        modelId: "after-model",
        enabled: true,
      },
      "admin1",
    );
    expect(updated.id).toBe("legacy-slot-script-split-text");
    expect(updated.legacyVirtual).toBe(true);
    expect(updated.modelId).toBe("after-model");
    const cfg = await getGenerationApiConfig("script-split-text");
    expect(cfg.model).toBe("after-model");
    const resolved = await resolveConnectionForSlot("script-split-text");
    expect(resolved.id).toBe("legacy-slot-script-split-text");
    expect(resolved.modelId).toBe("after-model");
  });

  it("rejects disabled connection", async () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const conn = await createConnection(
      {
        displayName: "Disabled",
        modality: "text",
        providerMode: "mock",
        enabled: false,
      },
      "admin1",
    );
    await bindSlot("story-text", conn.id, "admin1");
    await expect(resolveConnectionForSlot("story-text")).rejects.toMatchObject({
      code: "AI_MODEL_CONNECTION_DISABLED",
    });
  });
});
