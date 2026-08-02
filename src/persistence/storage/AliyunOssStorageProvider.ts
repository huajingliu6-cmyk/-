import "server-only";
import OSS from "ali-oss";
import {
  assertSafeStorageKey,
  type FileStorageProvider,
  type ObjectStat,
  type PresignedUploadInput,
  type PresignedUploadResult,
  type PutObjectInput,
  type PutObjectResult,
  type SignedReadUrlInput,
} from "@/persistence/storage/types";
import {
  getAliyunOssConfig,
  PersistenceConfigError,
  type AliyunOssConfig,
} from "@/persistence/config";

export type AliyunOssClientFactory = (cfg: AliyunOssConfig) => OSSLike;

export type OSSLike = {
  put: (
    name: string,
    file: Buffer,
    options?: { headers?: Record<string, string> },
  ) => Promise<{ name: string; res?: { headers?: Record<string, string> } }>;
  delete: (name: string) => Promise<unknown>;
  head: (name: string) => Promise<{
    res?: { headers?: Record<string, string | number | undefined> };
  }>;
  signatureUrl: (
    name: string,
    options?: { expires?: number; method?: string; "Content-Type"?: string },
  ) => string;
};

/**
 * Production object storage (private bucket).
 * Auth priority:
 * 1) Default credential chain / ECS RAM role (when allowed)
 * 2) STS temporary credentials (security token + keys)
 * 3) Controlled AccessKey (dev / locked-down deploys only)
 *
 * Secrets never use NEXT_PUBLIC_*.
 */
export class AliyunOssStorageProvider implements FileStorageProvider {
  readonly driver = "aliyun_oss" as const;
  private readonly cfg: AliyunOssConfig;
  private readonly client: OSSLike;

  constructor(options?: {
    config?: AliyunOssConfig;
    clientFactory?: AliyunOssClientFactory;
  }) {
    this.cfg = options?.config ?? getAliyunOssConfig();
    if (!this.cfg.region || !this.cfg.bucket) {
      throw new PersistenceConfigError(
        "MISSING_OSS_CONFIG",
        "ALIYUN_OSS_REGION and ALIYUN_OSS_BUCKET are required",
      );
    }
    const factory =
      options?.clientFactory ??
      ((cfg) => {
        if (cfg.accessKeyId && cfg.accessKeySecret) {
          return new OSS({
            region: cfg.region,
            bucket: cfg.bucket,
            endpoint: cfg.endpoint || undefined,
            secure: true,
            accessKeyId: cfg.accessKeyId,
            accessKeySecret: cfg.accessKeySecret,
            stsToken: cfg.securityToken || undefined,
          }) as unknown as OSSLike;
        }
        // Default credential chain — may throw at first network call if unavailable.
        return new OSS({
          region: cfg.region,
          bucket: cfg.bucket,
          endpoint: cfg.endpoint || undefined,
          secure: true,
          accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || "",
          accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || "",
          stsToken: process.env.ALIBABA_CLOUD_SECURITY_TOKEN || undefined,
        }) as unknown as OSSLike;
      });
    this.client = factory(this.cfg);
  }

  private key(storageKey: string): string {
    return assertSafeStorageKey(storageKey);
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const name = this.key(input.storageKey);
    const result = await this.client.put(name, input.body, {
      headers: { "Content-Type": input.contentType },
    });
    const etag = result.res?.headers?.etag;
    return {
      storageKey: name,
      size: input.body.length,
      etag: typeof etag === "string" ? etag : undefined,
    };
  }

  async createPresignedUpload(
    input: PresignedUploadInput,
  ): Promise<PresignedUploadResult> {
    const name = this.key(input.storageKey);
    const uploadUrl = this.client.signatureUrl(name, {
      method: "PUT",
      expires: input.expiresInSeconds,
      "Content-Type": input.contentType,
    });
    return {
      uploadUrl,
      storageKey: name,
      headers: {
        "Content-Type": input.contentType,
        "x-oss-forbid-overwrite": "true",
      },
      expiresAt: new Date(
        Date.now() + input.expiresInSeconds * 1000,
      ).toISOString(),
    };
  }

  async createSignedReadUrl(input: SignedReadUrlInput): Promise<string> {
    const name = this.key(input.storageKey);
    return this.client.signatureUrl(name, {
      method: "GET",
      expires: input.expiresInSeconds,
    });
  }

  async statObject(storageKey: string): Promise<ObjectStat | null> {
    try {
      const name = this.key(storageKey);
      const head = await this.client.head(name);
      const headers = head.res?.headers ?? {};
      const sizeRaw = headers["content-length"];
      const size =
        typeof sizeRaw === "number"
          ? sizeRaw
          : Number.parseInt(String(sizeRaw ?? "0"), 10);
      return {
        storageKey: name,
        size: Number.isFinite(size) ? size : 0,
        contentType:
          typeof headers["content-type"] === "string"
            ? headers["content-type"]
            : undefined,
      };
    } catch {
      return null;
    }
  }

  async deleteObject(storageKey: string): Promise<void> {
    await this.client.delete(this.key(storageKey));
  }

  async objectExists(storageKey: string): Promise<boolean> {
    return (await this.statObject(storageKey)) != null;
  }
}
