import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  deleteRemoteBlob,
  getRemoteBlob,
  isRemoteDataOnly,
  putRemoteBlob,
  type RemoteBlob,
} from "@/persistence/remote-data-client";

function assetsDir(): string {
  return resolveAppDataPath("assets");
}

export const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const AUDIO_MIME = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/aac",
]);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/m4a": ".m4a",
  "audio/aac": ".aac",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

const ALLOWED_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".mp4",
  ".mov",
]);

export type StoredAssetMeta = {
  assetId: string;
  assetUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "audio" | "video";
};

const SAFE_ASSET_ID = /^[0-9a-fA-F-]{36}$/;

export function workflowAssetStorageKey(assetId: string): string {
  if (!SAFE_ASSET_ID.test(assetId) || assetId.includes("..")) {
    throw new Error("INVALID_WORKFLOW_ASSET_ID");
  }
  return `workflow-assets/${assetId}`;
}

export async function ensureAssetsDir() {
  await fs.mkdir(assetsDir(), { recursive: true });
}

function extensionFromName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return ext;
}

export function classifyAsset(
  mimeType: string,
  fileName: string,
): { kind: "image" | "audio"; ext: string } | { error: string } {
  const ext = extensionFromName(fileName);
  if (!ALLOWED_EXT.has(ext) && ext !== ".jpeg") {
    return {
      error: `不支持的文件扩展名：${ext || "（无）"}。图片支持 JPG/PNG/WEBP，音频支持 MP3/WAV/M4A/AAC`,
    };
  }

  if (IMAGE_MIME.has(mimeType)) {
    if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
      return { error: "图片 MIME 类型与扩展名不匹配" };
    }
    return { kind: "image", ext: EXT_BY_MIME[mimeType] ?? ".jpg" };
  }

  if (AUDIO_MIME.has(mimeType)) {
    if (![".mp3", ".wav", ".m4a", ".aac"].includes(ext)) {
      return { error: "音频 MIME 类型与扩展名不匹配" };
    }
    return { kind: "audio", ext: EXT_BY_MIME[mimeType] ?? ".mp3" };
  }

  return {
    error: `不支持的文件类型：${mimeType || "未知"}。图片支持 JPG/PNG/WEBP，音频支持 MP3/WAV/M4A/AAC`,
  };
}

export async function saveAssetFile(params: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  kind: "image" | "audio" | "video";
  ext: string;
}): Promise<StoredAssetMeta> {
  const assetId = randomUUID();
  if (isRemoteDataOnly()) {
    await putRemoteBlob({
      storageKey: workflowAssetStorageKey(assetId),
      contentType: params.mimeType,
      body: params.buffer,
    });
    return {
      assetId,
      assetUrl: `/api/assets/${assetId}`,
      fileName: path.basename(params.fileName).slice(0, 180),
      mimeType: params.mimeType,
      sizeBytes: params.buffer.byteLength,
      kind: params.kind,
    };
  }
  await ensureAssetsDir();
  // 禁止使用用户原始文件名作为磁盘文件名，防止路径穿越
  const diskName = `${assetId}${params.ext}`;
  const diskPath = path.join(assetsDir(), diskName);
  const resolved = path.resolve(diskPath);
  if (!resolved.startsWith(path.resolve(assetsDir()) + path.sep)) {
    throw new Error("非法文件路径");
  }

  await fs.writeFile(resolved, params.buffer);

  return {
    assetId,
    assetUrl: `/api/assets/${assetId}`,
    fileName: path.basename(params.fileName).slice(0, 180),
    mimeType: params.mimeType,
    sizeBytes: params.buffer.byteLength,
    kind: params.kind,
  };
}

export function readRemoteAssetFile(assetId: string): Promise<RemoteBlob | null> {
  return getRemoteBlob(workflowAssetStorageKey(assetId));
}

export async function resolveAssetPath(
  assetId: string,
): Promise<{ filePath: string; mimeType: string } | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(assetId)) {
    return null;
  }

  await ensureAssetsDir();
  const entries = await fs.readdir(assetsDir());
  const match = entries.find((name) => name.startsWith(`${assetId}.`));
  if (!match) return null;

  const filePath = path.join(assetsDir(), match);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(assetsDir()) + path.sep)) {
    return null;
  }

  const ext = path.extname(match).toLowerCase();
  const mimeType =
    Object.entries(EXT_BY_MIME).find(([, e]) => e === ext)?.[0] ??
    "application/octet-stream";

  return { filePath: resolved, mimeType };
}

export type AssetIndexEntry = {
  assetId: string;
  fileName: string;
};

/**
 * 元数据仅存于 WorkflowDocument.assets；此函数为兼容占位，不写入侧车 JSON。
 */
export async function saveAssetRecordMeta(): Promise<void> {
  return;
}

/** 扫描本地 assets 目录，返回已上传文件的 assetId 索引（不含 WorkflowDocument 元数据）。 */
export async function loadAssetIndex(): Promise<AssetIndexEntry[]> {
  await ensureAssetsDir();
  const entries = await fs.readdir(assetsDir());
  const index: AssetIndexEntry[] = [];

  for (const fileName of entries) {
    const match = fileName.match(
      /^([0-9a-fA-F-]{36})(\.[a-zA-Z0-9]+)$/,
    );
    if (!match) continue;

    const assetId = match[1];
    const filePath = path.join(assetsDir(), fileName);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(assetsDir()) + path.sep)) {
      continue;
    }

    index.push({ assetId, fileName });
  }

  return index;
}

/** 删除磁盘上的素材文件；assetId 非法或文件不存在时返回 false。 */
export async function deleteAssetFile(assetId: string): Promise<boolean> {
  if (isRemoteDataOnly()) {
    await deleteRemoteBlob(workflowAssetStorageKey(assetId));
    return true;
  }
  if (!/^[0-9a-fA-F-]{36}$/.test(assetId)) {
    return false;
  }

  const resolvedAsset = await resolveAssetPath(assetId);
  if (!resolvedAsset) {
    return false;
  }

  const assetsRoot = path.resolve(assetsDir());
  if (!resolvedAsset.filePath.startsWith(assetsRoot + path.sep)) {
    return false;
  }

  try {
    await fs.unlink(resolvedAsset.filePath);
    return true;
  } catch {
    return false;
  }
}
