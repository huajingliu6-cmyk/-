export type PutObjectInput = {
  storageKey: string;
  body: Buffer;
  contentType: string;
};

export type PutObjectResult = {
  storageKey: string;
  size: number;
  etag?: string;
};

export type PresignedUploadInput = {
  storageKey: string;
  contentType: string;
  maxSizeBytes: number;
  expiresInSeconds: number;
};

export type PresignedUploadResult = {
  uploadUrl: string;
  storageKey: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export type SignedReadUrlInput = {
  storageKey: string;
  expiresInSeconds: number;
};

export type ObjectStat = {
  storageKey: string;
  size: number;
  contentType?: string;
  lastModified?: Date;
};

export interface FileStorageProvider {
  readonly driver: "local" | "aliyun_oss" | "fake";
  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  createPresignedUpload(
    input: PresignedUploadInput,
  ): Promise<PresignedUploadResult>;
  createSignedReadUrl(input: SignedReadUrlInput): Promise<string>;
  statObject(storageKey: string): Promise<ObjectStat | null>;
  deleteObject(storageKey: string): Promise<void>;
  objectExists(storageKey: string): Promise<boolean>;
}

export function assertSafeStorageKey(storageKey: string): string {
  const key = storageKey.trim().replace(/\\/g, "/");
  if (!key) {
    throw new Error("storageKey is required");
  }
  if (key.startsWith("/") || /^[a-zA-Z]:/.test(key)) {
    throw new Error("storageKey must be a relative key, not an absolute path");
  }
  if (key.includes("..") || key.includes("\0")) {
    throw new Error("storageKey contains illegal path segments");
  }
  if (!key.startsWith("projects/")) {
    throw new Error('storageKey must start with "projects/"');
  }
  return key;
}

export function buildProjectStorageKey(input: {
  projectId: string;
  purpose: string;
  fileId: string;
  safeFileName: string;
}): string {
  const safeName = input.safeFileName
    .replace(/[^\w.\-()+]/g, "_")
    .slice(0, 120);
  return assertSafeStorageKey(
    `projects/${input.projectId}/${input.purpose}/${input.fileId}/${safeName || "file"}`,
  );
}
