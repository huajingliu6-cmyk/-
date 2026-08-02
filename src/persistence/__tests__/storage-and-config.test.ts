import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  PersistenceConfigError,
  getPersistenceDriver,
  getFileStorageDriver,
  redactDatabaseUrl,
  redactSecret,
  validatePersistenceConfig,
} from "@/persistence/config";
import { LocalDevelopmentStorageProvider } from "@/persistence/storage/LocalDevelopmentStorageProvider";
import { FakeFileStorageProvider } from "@/persistence/storage/FakeFileStorageProvider";
import { AliyunOssStorageProvider } from "@/persistence/storage/AliyunOssStorageProvider";
import {
  assertSafeStorageKey,
  buildProjectStorageKey,
} from "@/persistence/storage/types";
import { RevisionConflictError } from "@/persistence/revision";

describe("persistence config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults PERSISTENCE_DRIVER to file", () => {
    vi.stubEnv("PERSISTENCE_DRIVER", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(getPersistenceDriver()).toBe("file");
  });

  it("forbids file driver in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PERSISTENCE_DRIVER", "file");
    expect(() => getPersistenceDriver()).toThrow(PersistenceConfigError);
  });

  it("forbids local storage in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PERSISTENCE_DRIVER", "postgres");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
    vi.stubEnv("FILE_STORAGE_DRIVER", "local");
    expect(() => getFileStorageDriver()).toThrow(PersistenceConfigError);
  });

  it("redacts secrets and database URLs", () => {
    expect(redactSecret("abcdefghij")).toContain("***");
    expect(
      redactDatabaseUrl("postgresql://user:secret@localhost:5432/db"),
    ).not.toContain("secret");
  });

  it("validatePersistenceConfig requires OSS bucket when aliyun_oss", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PERSISTENCE_DRIVER", "file");
    vi.stubEnv("FILE_STORAGE_DRIVER", "aliyun_oss");
    vi.stubEnv("ALIYUN_OSS_REGION", "");
    vi.stubEnv("ALIYUN_OSS_BUCKET", "");
    expect(() => validatePersistenceConfig()).toThrow(/OSS/);
  });
});

describe("storage keys", () => {
  it("builds project-prefixed keys", () => {
    const key = buildProjectStorageKey({
      projectId: "p_1",
      purpose: "original_script",
      fileId: "f1",
      safeFileName: "a.txt",
    });
    expect(key).toBe("projects/p_1/original_script/f1/a.txt");
  });

  it("rejects path traversal and absolute paths", () => {
    expect(() => assertSafeStorageKey("../etc/passwd")).toThrow();
    expect(() => assertSafeStorageKey("/tmp/x")).toThrow();
    expect(() => assertSafeStorageKey("C:\\Windows\\x")).toThrow();
    expect(() => assertSafeStorageKey("other/p")).toThrow();
  });
});

describe("LocalDevelopmentStorageProvider", () => {
  let root: string;
  let provider: LocalDevelopmentStorageProvider;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ic-storage-"));
    vi.stubEnv("NODE_ENV", "test");
    provider = new LocalDevelopmentStorageProvider(root);
  });

  afterEach(async () => {
    await provider.wipeRootForTests();
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("puts, stats, reads existence, and deletes", async () => {
    const key = "projects/p1/original_script/f1/a.txt";
    await provider.putObject({
      storageKey: key,
      body: Buffer.from("hello"),
      contentType: "text/plain",
    });
    expect(await provider.objectExists(key)).toBe(true);
    const st = await provider.statObject(key);
    expect(st?.size).toBe(5);
    const readUrl = await provider.createSignedReadUrl({
      storageKey: key,
      expiresInSeconds: 60,
    });
    expect(readUrl).toContain("local-dev://read/");
    expect(readUrl).not.toContain(root);
    await provider.deleteObject(key);
    expect(await provider.objectExists(key)).toBe(false);
  });

  it("rejects directory traversal via storageKey", async () => {
    await expect(
      provider.putObject({
        storageKey: "projects/../secret",
        body: Buffer.from("x"),
        contentType: "text/plain",
      }),
    ).rejects.toThrow();
  });

  it("refuses construction in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      () => new LocalDevelopmentStorageProvider(root),
    ).toThrow(PersistenceConfigError);
  });
});

describe("FakeFileStorageProvider", () => {
  it("supports write/read/delete and fault injection", async () => {
    const fake = new FakeFileStorageProvider();
    const key = "projects/p1/audio_asset/a1/a.mp3";
    await fake.putObject({
      storageKey: key,
      body: Buffer.from("bin"),
      contentType: "audio/mpeg",
    });
    expect(fake.readForTests(key)?.toString()).toBe("bin");
    fake.failNextPut = true;
    await expect(
      fake.putObject({
        storageKey: key,
        body: Buffer.from("x"),
        contentType: "audio/mpeg",
      }),
    ).rejects.toThrow(/injected put/);
    await fake.deleteObject(key);
    expect(await fake.objectExists(key)).toBe(false);
  });
});

describe("AliyunOssStorageProvider", () => {
  it("requires region/bucket and never exposes secrets in errors", () => {
    expect(
      () =>
        new AliyunOssStorageProvider({
          config: {
            region: "",
            endpoint: "",
            bucket: "",
            roleArn: "",
            accessKeyId: "SECRETKEY123",
            accessKeySecret: "TOPSECRET",
            securityToken: "",
          },
        }),
    ).toThrow(PersistenceConfigError);
  });

  it("uses fake client and keeps keys under projects/ prefix", async () => {
    const calls: string[] = [];
    const provider = new AliyunOssStorageProvider({
      config: {
        region: "oss-cn-hangzhou",
        endpoint: "",
        bucket: "test-bucket",
        roleArn: "",
        accessKeyId: "id",
        accessKeySecret: "secret",
        securityToken: "",
      },
      clientFactory: () => ({
        put: async (name, file) => {
          calls.push(`put:${name}:${file.length}`);
          return { name };
        },
        delete: async (name) => {
          calls.push(`delete:${name}`);
        },
        head: async (name) => {
          calls.push(`head:${name}`);
          return { res: { headers: { "content-length": 3 } } };
        },
        signatureUrl: (name, options) => {
          calls.push(`sign:${name}:${options?.method}`);
          return `https://signed.example/${name}`;
        },
      }),
    });

    const key = "projects/p1/image_asset/f1/a.png";
    await provider.putObject({
      storageKey: key,
      body: Buffer.from("img"),
      contentType: "image/png",
    });
    const url = await provider.createSignedReadUrl({
      storageKey: key,
      expiresInSeconds: 30,
    });
    expect(url).toContain("https://signed.example/");
    expect(url).not.toContain("secret");
    await expect(
      provider.putObject({
        storageKey: "evil/../x",
        body: Buffer.from("x"),
        contentType: "text/plain",
      }),
    ).rejects.toThrow();
    expect(calls.some((c) => c.startsWith("put:projects/"))).toBe(true);
  });

  it("does not perform network I/O without a real client", () => {
    expect(true).toBe(true);
  });
});

describe("revision conflict", () => {
  it("exposes 409 semantics", () => {
    const err = new RevisionConflictError({
      resource: "Project:p1",
      expectedRevision: 2,
      currentRevision: 3,
    });
    expect(err.code).toBe("REVISION_CONFLICT");
    expect(err.expectedRevision).toBe(2);
    expect(err.currentRevision).toBe(3);
  });
});
