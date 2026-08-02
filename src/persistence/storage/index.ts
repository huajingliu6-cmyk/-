import "server-only";
import {
  getFileStorageDriver,
  getLocalStorageRoot,
} from "@/persistence/config";
import { AliyunOssStorageProvider } from "@/persistence/storage/AliyunOssStorageProvider";
import { LocalDevelopmentStorageProvider } from "@/persistence/storage/LocalDevelopmentStorageProvider";
import type { FileStorageProvider } from "@/persistence/storage/types";

export type {
  FileStorageProvider,
  PutObjectInput,
  PutObjectResult,
} from "@/persistence/storage/types";
export { buildProjectStorageKey, assertSafeStorageKey } from "@/persistence/storage/types";
export { FakeFileStorageProvider } from "@/persistence/storage/FakeFileStorageProvider";
export { LocalDevelopmentStorageProvider } from "@/persistence/storage/LocalDevelopmentStorageProvider";
export { AliyunOssStorageProvider } from "@/persistence/storage/AliyunOssStorageProvider";

let cached: FileStorageProvider | null = null;

export function getFileStorageProvider(): FileStorageProvider {
  if (cached) return cached;
  const driver = getFileStorageDriver();
  if (driver === "local") {
    cached = new LocalDevelopmentStorageProvider(getLocalStorageRoot());
  } else {
    cached = new AliyunOssStorageProvider();
  }
  return cached;
}

/** Test-only: replace / clear provider singleton. */
export function __setFileStorageProviderForTests(
  provider: FileStorageProvider | null,
): void {
  cached = provider;
}
