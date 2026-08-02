import "server-only";
import path from "path";
import { getAppDataDir } from "@/persistence/data-root";

export type PersistenceDriver = "file" | "postgres";
export type FileStorageDriver = "local" | "aliyun_oss";

export class PersistenceConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PersistenceConfigError";
    this.code = code;
  }
}

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function getPersistenceDriver(): PersistenceDriver {
  const raw = readEnv("PERSISTENCE_DRIVER") || "file";
  if (raw !== "file" && raw !== "postgres") {
    throw new PersistenceConfigError(
      "INVALID_PERSISTENCE_DRIVER",
      `PERSISTENCE_DRIVER must be "file" or "postgres"`,
    );
  }
  if (process.env.NODE_ENV === "production" && raw === "file") {
    // Isolated smoke / local verification only — never enable in real production.
    if (readEnv("ALLOW_FILE_DRIVER_IN_PRODUCTION") === "true") {
      return raw;
    }
    throw new PersistenceConfigError(
      "FILE_DRIVER_FORBIDDEN_IN_PRODUCTION",
      "Production must use PERSISTENCE_DRIVER=postgres",
    );
  }
  return raw;
}

export function getFileStorageDriver(): FileStorageDriver {
  const raw = readEnv("FILE_STORAGE_DRIVER") || "local";
  if (raw !== "local" && raw !== "aliyun_oss") {
    throw new PersistenceConfigError(
      "INVALID_FILE_STORAGE_DRIVER",
      `FILE_STORAGE_DRIVER must be "local" or "aliyun_oss"`,
    );
  }
  if (process.env.NODE_ENV === "production" && raw === "local") {
    throw new PersistenceConfigError(
      "LOCAL_STORAGE_FORBIDDEN_IN_PRODUCTION",
      "Production must use FILE_STORAGE_DRIVER=aliyun_oss",
    );
  }
  return raw;
}

export function requireDatabaseUrl(): string {
  const url = readEnv("DATABASE_URL");
  if (!url) {
    throw new PersistenceConfigError(
      "MISSING_DATABASE_URL",
      "DATABASE_URL is required for PostgreSQL persistence",
    );
  }
  return url;
}

export function getLocalStorageRoot(): string {
  const root = readEnv("LOCAL_STORAGE_ROOT");
  if (root) {
    return path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
  }
  return path.join(getAppDataDir(), "object-storage");
}

export type AliyunOssConfig = {
  region: string;
  endpoint: string;
  bucket: string;
  roleArn: string;
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
};

export function getAliyunOssConfig(): AliyunOssConfig {
  return {
    region: readEnv("ALIYUN_OSS_REGION"),
    endpoint: readEnv("ALIYUN_OSS_ENDPOINT"),
    bucket: readEnv("ALIYUN_OSS_BUCKET"),
    roleArn: readEnv("ALIYUN_OSS_ROLE_ARN"),
    accessKeyId: readEnv("ALIYUN_OSS_ACCESS_KEY_ID"),
    accessKeySecret: readEnv("ALIYUN_OSS_ACCESS_KEY_SECRET"),
    securityToken: readEnv("ALIYUN_OSS_SECURITY_TOKEN"),
  };
}

/** Redact secrets for logs — never print full connection strings or keys. */
export function redactSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export function redactDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "[invalid-database-url]";
  }
}

/**
 * Validate persistence-related env for the current runtime.
 * Safe to call from server boot / scripts; does not connect to DB.
 */
export function validatePersistenceConfig(input?: {
  nodeEnv?: string;
  requireDb?: boolean;
}): void {
  const nodeEnv = input?.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const driver = getPersistenceDriver();
  const storage = getFileStorageDriver();

  if (input?.requireDb || driver === "postgres") {
    requireDatabaseUrl();
  }

  if (storage === "local") {
    if (nodeEnv === "production") {
      throw new PersistenceConfigError(
        "LOCAL_STORAGE_FORBIDDEN_IN_PRODUCTION",
        "Local file storage is not allowed in production",
      );
    }
    void getLocalStorageRoot();
  }

  if (storage === "aliyun_oss") {
    const cfg = getAliyunOssConfig();
    if (!cfg.region || !cfg.bucket) {
      throw new PersistenceConfigError(
        "MISSING_OSS_CONFIG",
        "ALIYUN_OSS_REGION and ALIYUN_OSS_BUCKET are required for aliyun_oss",
      );
    }
    const hasStatic =
      Boolean(cfg.accessKeyId) && Boolean(cfg.accessKeySecret);
    const hasRole = Boolean(cfg.roleArn);
    // Default credential chain (ECS RAM role) is allowed without static keys.
    // At least one auth path must be intentional in controlled deploys.
    if (!hasStatic && !hasRole && nodeEnv === "production") {
      // Still allow default credential chain; document that operators must
      // ensure instance role is attached. Soft warning via structured error
      // only when nothing is configured and we are not in a skippable test.
      if (!readEnv("ALIYUN_OSS_ALLOW_DEFAULT_CREDENTIAL_CHAIN")) {
        throw new PersistenceConfigError(
          "MISSING_OSS_CREDENTIALS",
          "Provide OSS credentials via RAM role / STS / AccessKey, or set ALIYUN_OSS_ALLOW_DEFAULT_CREDENTIAL_CHAIN=1",
        );
      }
    }
  }
}
