import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  encryptApiKey,
  decryptApiKey,
  isEncryptedSecret,
  parseAiConfigEncryptionKey,
  requireAiConfigEncryptionKey,
  sealApiKeyForStorage,
  AiSecretCryptoError,
} from "@/ai-config/secret-crypto";
import {
  listGenerationApiConfigs,
  toPublicConfig,
  updateGenerationApiConfig,
  listConfigAuditEntries,
} from "@/auth/api-config";
import { resolveAppDataPath } from "@/persistence/data-root";

describe("AI config secret encryption", () => {
  const previousDir = process.env.APP_DATA_DIR;
  const previousKey = process.env.AI_CONFIG_ENCRYPTION_KEY;
  let tmp = "";
  const master = Buffer.alloc(32, 9).toString("base64");

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-secret-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.AI_CONFIG_ENCRYPTION_KEY = master;
  });

  afterEach(() => {
    if (previousDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousDir;
    if (previousKey === undefined) delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    else process.env.AI_CONFIG_ENCRYPTION_KEY = previousKey;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("round-trips AES-256-GCM and rejects wrong key", () => {
    const key = requireAiConfigEncryptionKey();
    const sealed = encryptApiKey("sk-test-secret-key-abcdef", key);
    expect(isEncryptedSecret(sealed)).toBe(true);
    expect(sealed).not.toContain("sk-test-secret-key-abcdef");
    expect(decryptApiKey(sealed, key)).toBe("sk-test-secret-key-abcdef");
    const other = Buffer.alloc(32, 3);
    expect(() => decryptApiKey(sealed, other)).toThrow(AiSecretCryptoError);
  });

  it("rejects invalid master key length", () => {
    expect(() => parseAiConfigEncryptionKey(Buffer.alloc(16).toString("base64"))).toThrow(
      /32/,
    );
  });

  it("saves new key encrypted on disk; GET never returns raw", async () => {
    const secret = "sk-f1r-disk-secret-123456";
    await updateGenerationApiConfig(
      "story-text",
      { provider: "mock", apiKey: secret },
      "admin",
    );
    const disk = readFileSync(
      resolveAppDataPath("generation-api-configs.json"),
      "utf8",
    );
    expect(disk).not.toContain(secret);
    expect(disk).toContain("enc:v1:");
    const configs = await listGenerationApiConfigs();
    const story = configs.find((c) => c.id === "story-text")!;
    expect(story.apiKey).toBe(secret);
    const pub = toPublicConfig(story);
    expect(pub).not.toHaveProperty("apiKey");
    expect(JSON.stringify(pub)).not.toContain(secret);
    expect(pub.hasApiKey).toBe(true);
    expect(pub.apiKeyMasked).not.toBe(secret);
    expect(pub.apiKeyMasked.length).toBeLessThan(secret.length);
  });

  it("empty key patch retains previous secret", async () => {
    await updateGenerationApiConfig(
      "story-text",
      { apiKey: "sk-keep-this-secret-zz" },
      "admin",
    );
    await updateGenerationApiConfig(
      "story-text",
      { model: "mock-b", apiKey: "" },
      "admin",
    );
    const story = (await listGenerationApiConfigs()).find(
      (c) => c.id === "story-text",
    )!;
    expect(story.apiKey).toBe("sk-keep-this-secret-zz");
    expect(story.model).toBe("mock-b");
  });

  it("explicit clear removes secret", async () => {
    await updateGenerationApiConfig(
      "story-text",
      { apiKey: "sk-clear-me-please-xx" },
      "admin",
    );
    await updateGenerationApiConfig("story-text", { apiKey: null }, "admin");
    const story = (await listGenerationApiConfigs()).find(
      (c) => c.id === "story-text",
    )!;
    expect(story.apiKey).toBe("");
    expect(toPublicConfig(story).hasApiKey).toBe(false);
  });

  it("cannot save new secret without master key", async () => {
    delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    await expect(
      updateGenerationApiConfig(
        "story-text",
        { apiKey: "sk-no-master-key-here" },
        "admin",
      ),
    ).rejects.toMatchObject({ code: "AI_CONFIG_ENCRYPTION_KEY_MISSING" });
    const configs = await listGenerationApiConfigs();
    expect(configs.length).toBeGreaterThan(0);
  });

  it("legacy plaintext readable and re-save encrypts", async () => {
    delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    const file = resolveAppDataPath("generation-api-configs.json");
    const { writeFileSync, mkdirSync } = await import("fs");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        configs: [
          {
            id: "story-text",
            label: "故事文本模型",
            description: "x",
            provider: "mock",
            apiUrl: "",
            apiKey: "sk-legacy-plain-key-99",
            model: "m",
            enabled: true,
            updatedAt: new Date().toISOString(),
          },
        ],
        bindings: [],
        audit: [],
      }),
      "utf8",
    );
    const loaded = (await listGenerationApiConfigs()).find(
      (c) => c.id === "story-text",
    )!;
    expect(loaded.apiKey).toBe("sk-legacy-plain-key-99");
    expect(loaded.legacyPlaintextSecret).toBe(true);

    process.env.AI_CONFIG_ENCRYPTION_KEY = master;
    await updateGenerationApiConfig(
      "story-text",
      { model: "m2" },
      "admin",
    );
    const disk = readFileSync(file, "utf8");
    expect(disk).not.toContain("sk-legacy-plain-key-99");
    expect(disk).toContain("enc:v1:");
  });

  it("audit log never contains secret values", async () => {
    await updateGenerationApiConfig(
      "story-text",
      { apiKey: "sk-audit-must-not-leak-1" },
      "admin",
    );
    const audit = await listConfigAuditEntries(20);
    expect(JSON.stringify(audit)).not.toContain("sk-audit-must-not-leak-1");
  });

  it("sealApiKeyForStorage requires key", () => {
    delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    expect(() => sealApiKeyForStorage("sk-abc12345")).toThrow(AiSecretCryptoError);
  });
});
