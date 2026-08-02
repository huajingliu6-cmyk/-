import "server-only";
import { promises as fs } from "fs";
import path from "path";
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
import { PersistenceConfigError } from "@/persistence/config";

/**
 * Development / test only. Production must use AliyunOssStorageProvider.
 */
export class LocalDevelopmentStorageProvider implements FileStorageProvider {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(rootDir: string, options?: { allowInProduction?: boolean }) {
    if (
      process.env.NODE_ENV === "production" &&
      !options?.allowInProduction
    ) {
      throw new PersistenceConfigError(
        "LOCAL_STORAGE_FORBIDDEN_IN_PRODUCTION",
        "LocalDevelopmentStorageProvider cannot run in production",
      );
    }
    this.root = path.resolve(rootDir);
  }

  private resolveKey(storageKey: string): string {
    const key = assertSafeStorageKey(storageKey);
    const full = path.resolve(this.root, key);
    const rootWithSep = this.root.endsWith(path.sep)
      ? this.root
      : this.root + path.sep;
    if (full !== this.root && !full.startsWith(rootWithSep)) {
      throw new Error("storageKey escapes local storage root");
    }
    return full;
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const full = this.resolveKey(input.storageKey);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, input.body);
    return { storageKey: input.storageKey, size: input.body.length };
  }

  async createPresignedUpload(
    input: PresignedUploadInput,
  ): Promise<PresignedUploadResult> {
    // Local driver does not expose public URLs; callers use putObject.
    const expiresAt = new Date(
      Date.now() + input.expiresInSeconds * 1000,
    ).toISOString();
    return {
      uploadUrl: `local-dev://upload/${assertSafeStorageKey(input.storageKey)}`,
      storageKey: input.storageKey,
      headers: {
        "Content-Type": input.contentType,
        "X-Max-Size": String(input.maxSizeBytes),
      },
      expiresAt,
    };
  }

  async createSignedReadUrl(input: SignedReadUrlInput): Promise<string> {
    // Browser must still go through authorized API routes — never return absolute disk paths.
    return `local-dev://read/${assertSafeStorageKey(input.storageKey)}?exp=${input.expiresInSeconds}`;
  }

  async statObject(storageKey: string): Promise<ObjectStat | null> {
    try {
      const full = this.resolveKey(storageKey);
      const st = await fs.stat(full);
      if (!st.isFile()) return null;
      return {
        storageKey,
        size: st.size,
        lastModified: st.mtime,
      };
    } catch {
      return null;
    }
  }

  async deleteObject(storageKey: string): Promise<void> {
    const full = this.resolveKey(storageKey);
    await fs.unlink(full).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
  }

  async objectExists(storageKey: string): Promise<boolean> {
    return (await this.statObject(storageKey)) != null;
  }

  /** Test helper: remove entire root tree when under a temp directory. */
  async wipeRootForTests(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
  }

  getRootForTests(): string {
    return this.root;
  }
}
