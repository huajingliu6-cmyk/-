/**
 * At-rest encryption for AI config API keys (AES-256-GCM).
 * Master key: AI_CONFIG_ENCRYPTION_KEY (base64 → exactly 32 bytes).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export const AI_CONFIG_SECRET_PREFIX = "enc:v1:";

export type EncryptedSecretEnvelope = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  authTag: string;
};

export class AiSecretCryptoError extends Error {
  readonly code:
    | "AI_CONFIG_ENCRYPTION_KEY_MISSING"
    | "AI_CONFIG_ENCRYPTION_KEY_INVALID"
    | "AI_CONFIG_SECRET_DECRYPT_FAILED";

  constructor(
    code: AiSecretCryptoError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AiSecretCryptoError";
    this.code = code;
  }
}

export function parseAiConfigEncryptionKey(
  raw: string | undefined,
): Buffer | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(trimmed, "base64");
  } catch {
    throw new AiSecretCryptoError(
      "AI_CONFIG_ENCRYPTION_KEY_INVALID",
      "AI_CONFIG_ENCRYPTION_KEY 不是有效的 Base64",
    );
  }
  if (buf.length !== 32) {
    throw new AiSecretCryptoError(
      "AI_CONFIG_ENCRYPTION_KEY_INVALID",
      "AI_CONFIG_ENCRYPTION_KEY 解码后必须恰好 32 字节",
    );
  }
  return buf;
}

export function requireAiConfigEncryptionKey(
  env: NodeJS.ProcessEnv = process.env,
): Buffer {
  const key = parseAiConfigEncryptionKey(env.AI_CONFIG_ENCRYPTION_KEY);
  if (!key) {
    throw new AiSecretCryptoError(
      "AI_CONFIG_ENCRYPTION_KEY_MISSING",
      "未配置 AI_CONFIG_ENCRYPTION_KEY，无法保存或解密 API 凭据",
    );
  }
  return key;
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(AI_CONFIG_SECRET_PREFIX);
}

export function encryptApiKey(
  plaintext: string,
  masterKey: Buffer,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const envelope: EncryptedSecretEnvelope = {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: authTag.toString("base64"),
  };
  return `${AI_CONFIG_SECRET_PREFIX}${Buffer.from(JSON.stringify(envelope), "utf8").toString("base64")}`;
}

export function decryptApiKey(
  stored: string,
  masterKey: Buffer,
): string {
  if (!isEncryptedSecret(stored)) {
    return stored;
  }
  try {
    const raw = Buffer.from(
      stored.slice(AI_CONFIG_SECRET_PREFIX.length),
      "base64",
    ).toString("utf8");
    const envelope = JSON.parse(raw) as EncryptedSecretEnvelope;
    if (
      envelope.version !== 1 ||
      envelope.algorithm !== "aes-256-gcm" ||
      !envelope.iv ||
      !envelope.ciphertext ||
      !envelope.authTag
    ) {
      throw new Error("invalid envelope");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      masterKey,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    if (err instanceof AiSecretCryptoError) throw err;
    throw new AiSecretCryptoError(
      "AI_CONFIG_SECRET_DECRYPT_FAILED",
      "无法解密 API 凭据（主密钥可能不匹配）",
    );
  }
}

/** Resolve stored key to plaintext for server use. Legacy plaintext passes through. */
export function resolveStoredApiKey(
  stored: string,
  env: NodeJS.ProcessEnv = process.env,
): { plaintext: string; legacyPlaintext: boolean } {
  const value = stored ?? "";
  if (!value) return { plaintext: "", legacyPlaintext: false };
  if (!isEncryptedSecret(value)) {
    return { plaintext: value, legacyPlaintext: true };
  }
  const key = requireAiConfigEncryptionKey(env);
  return {
    plaintext: decryptApiKey(value, key),
    legacyPlaintext: false,
  };
}

/** Prepare value for disk. Empty stays empty. New secrets require master key. */
export function sealApiKeyForStorage(
  plaintext: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = plaintext.trim();
  if (!value) return "";
  if (isEncryptedSecret(value)) return value;
  const key = requireAiConfigEncryptionKey(env);
  return encryptApiKey(value, key);
}
