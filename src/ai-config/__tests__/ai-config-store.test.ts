import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  listCapabilityBindings,
  listGenerationApiConfigs,
  toPublicConfig,
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "@/auth/api-config";
import { resolveAiCapabilityRuntimeConfig } from "@/ai-config/resolve";
import { assertSafeAiEndpointUrl, urlGuardOptionsForProfileSlot } from "@/ai-config/url-guard";

describe("ai config store + resolver", () => {
  const previous = process.env.APP_DATA_DIR;
  const previousText = process.env.TEXT_LLM_PROVIDER;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-ai-cfg-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.TEXT_LLM_PROVIDER = "mock";
    process.env.ALLOW_PRIVATE_AI_ENDPOINTS = "false";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    if (previousText === undefined) delete process.env.TEXT_LLM_PROVIDER;
    else process.env.TEXT_LLM_PROVIDER = previousText;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves storyboard prompt via bound model connection", async () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    process.env.ALLOW_PRIVATE_AI_ENDPOINTS = "true";
    const { createConnection, bindSlot } = await import(
      "@/ai-config/model-connections"
    );
    const conn = await createConnection(
      {
        displayName: "分镜提示词连接",
        modality: "text",
        providerMode: "http",
        baseUrl: "https://example.com/v1",
        modelId: "conn-storyboard-model",
        apiKey: "sk-connection-key-123456",
        enabled: true,
      },
      "admin",
    );
    await bindSlot("storyboard-prompt-text", conn.id, "admin");
    const resolved = await resolveAiCapabilityRuntimeConfig(
      "text.storyboard-prompt.generate",
    );
    expect(resolved.profile.provider).toBe("http");
    expect(resolved.profile.model).toBe("conn-storyboard-model");
    expect(resolved.secret).toBe("sk-connection-key-123456");
    expect(resolved.modelConnectionId).toBe(conn.id);
  });

  it("defaults include story and outline text profiles", async () => {
    const configs = await listGenerationApiConfigs();
    expect(configs.some((c) => c.id === "story-text")).toBe(true);
    expect(configs.some((c) => c.id === "script-outline-text")).toBe(true);
    const pub = toPublicConfig(configs[0]!);
    expect(pub).not.toHaveProperty("apiKey");
    expect(JSON.stringify(pub)).not.toMatch(/sk-/);
  });

  it("resolves story and outline independently", async () => {
    await updateGenerationApiConfig("story-text", {
      provider: "mock",
      model: "mock-story-model",
    });
    await updateGenerationApiConfig("script-outline-text", {
      provider: "mock",
      model: "mock-outline-model",
    });
    const story = await resolveAiCapabilityRuntimeConfig("story.generate");
    const outline = await resolveAiCapabilityRuntimeConfig(
      "script.outline.generate",
    );
    expect(story.profile.model).toBe("mock-story-model");
    expect(outline.profile.model).toBe("mock-outline-model");
    expect(story.secret).toBeNull();
  });

  it("allows rebinding outline to story-text profile", async () => {
    await updateCapabilityBinding(
      "script.outline.generate",
      { profileSlotId: "story-text" },
      "admin",
    );
    const outline = await resolveAiCapabilityRuntimeConfig(
      "script.outline.generate",
    );
    expect(outline.profile.id).toBe("story-text");
  });

  it("rejects planned capability resolve", async () => {
    await expect(
      resolveAiCapabilityRuntimeConfig("script.continue.generate"),
    ).rejects.toMatchObject({ code: "AI_CAPABILITY_PLANNED" });
  });

  it("rejects planned script.episodes.generate resolve", async () => {
    await expect(
      resolveAiCapabilityRuntimeConfig("script.episodes.generate"),
    ).rejects.toMatchObject({ code: "AI_CAPABILITY_PLANNED" });
  });

  it("resolves active asset.episode-design.generate to episode design profile", async () => {
    await updateGenerationApiConfig("episode-asset-design-text", {
      provider: "mock",
      enabled: true,
    });
    const resolved = await resolveAiCapabilityRuntimeConfig(
      "asset.episode-design.generate",
    );
    expect(resolved.profile.id).toBe("episode-asset-design-text");
  });

  it("rejects disabled binding", async () => {
    await updateCapabilityBinding(
      "story.generate",
      { enabled: false },
      "admin",
    );
    await expect(
      resolveAiCapabilityRuntimeConfig("story.generate"),
    ).rejects.toMatchObject({ code: "AI_CAPABILITY_DISABLED" });
  });

  it("explicit unbind stays unbound after list (no silent default restore)", async () => {
    await updateCapabilityBinding(
      "video.storyboard-episode.generate",
      { profileSlotId: null, enabled: true },
      "admin",
    );
    const bindings = await listCapabilityBindings();
    const ep = bindings.find(
      (b) => b.capabilityId === "video.storyboard-episode.generate",
    );
    expect(ep?.profileSlotId).toBeNull();
    await expect(
      resolveAiCapabilityRuntimeConfig("video.storyboard-episode.generate"),
    ).rejects.toMatchObject({ code: "AI_CAPABILITY_NOT_CONFIGURED" });
  });

  it("rejects modality mismatch binding", async () => {
    await expect(
      updateCapabilityBinding(
        "story.generate",
        { profileSlotId: "video-shot" },
        "admin",
      ),
    ).rejects.toThrow(/模态/);
  });

  it("public config never includes raw key", async () => {
    await updateGenerationApiConfig("story-text", {
      provider: "mock",
      apiKey: "sk-test-secret-key-123456",
    });
    const configs = await listGenerationApiConfigs();
    const story = configs.find((c) => c.id === "story-text")!;
    const pub = toPublicConfig(story);
    expect(pub.hasApiKey).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("sk-test-secret-key-123456");
    const bindings = await listCapabilityBindings();
    expect(JSON.stringify(bindings)).not.toContain("sk-test");
  });

  it("ssrf guard blocks private and metadata hosts", () => {
    expect(() => assertSafeAiEndpointUrl("http://127.0.0.1/v1")).toThrow();
    expect(() =>
      assertSafeAiEndpointUrl("https://169.254.169.254/latest"),
    ).toThrow();
    expect(() => assertSafeAiEndpointUrl("file:///etc/passwd")).toThrow();
    expect(() =>
      assertSafeAiEndpointUrl("https://user:pass@evil.example/v1"),
    ).toThrow();
  });

  it("allows http for sd2-platform and video-shot SD2 hosts", () => {
    expect(() =>
      assertSafeAiEndpointUrl(
        "http://36.212.37.227:3099",
        urlGuardOptionsForProfileSlot("sd2-platform"),
      ),
    ).not.toThrow();
    expect(() =>
      assertSafeAiEndpointUrl(
        "http://36.212.37.227:3099/v1/video/generations",
        urlGuardOptionsForProfileSlot("video-shot"),
      ),
    ).not.toThrow();
  });
});
