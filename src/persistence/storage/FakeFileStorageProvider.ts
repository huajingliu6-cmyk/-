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

type Stored = {
  body: Buffer;
  contentType: string;
};

/**
 * In-memory storage for unit / API tests. Never talks to real OSS.
 */
export class FakeFileStorageProvider implements FileStorageProvider {
  readonly driver = "fake" as const;
  private readonly objects = new Map<string, Stored>();
  failNextPut = false;
  failNextDelete = false;

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const key = assertSafeStorageKey(input.storageKey);
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("FakeFileStorageProvider: injected put failure");
    }
    this.objects.set(key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
    });
    return { storageKey: key, size: input.body.length, etag: "fake-etag" };
  }

  async createPresignedUpload(
    input: PresignedUploadInput,
  ): Promise<PresignedUploadResult> {
    const key = assertSafeStorageKey(input.storageKey);
    return {
      uploadUrl: `https://fake-oss.example/upload/${key}`,
      storageKey: key,
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(
        Date.now() + input.expiresInSeconds * 1000,
      ).toISOString(),
    };
  }

  async createSignedReadUrl(input: SignedReadUrlInput): Promise<string> {
    const key = assertSafeStorageKey(input.storageKey);
    return `https://fake-oss.example/read/${key}?exp=${input.expiresInSeconds}`;
  }

  async statObject(storageKey: string): Promise<ObjectStat | null> {
    const key = assertSafeStorageKey(storageKey);
    const obj = this.objects.get(key);
    if (!obj) return null;
    return {
      storageKey: key,
      size: obj.body.length,
      contentType: obj.contentType,
    };
  }

  async deleteObject(storageKey: string): Promise<void> {
    const key = assertSafeStorageKey(storageKey);
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("FakeFileStorageProvider: injected delete failure");
    }
    this.objects.delete(key);
  }

  async objectExists(storageKey: string): Promise<boolean> {
    return this.objects.has(assertSafeStorageKey(storageKey));
  }

  readForTests(storageKey: string): Buffer | null {
    return this.objects.get(assertSafeStorageKey(storageKey))?.body ?? null;
  }

  clear(): void {
    this.objects.clear();
  }
}
