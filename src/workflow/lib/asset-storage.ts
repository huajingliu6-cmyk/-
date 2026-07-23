import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets");

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
};

const ALLOWED_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".mp3",
  ".wav",
  ".m4a",
]);

export type StoredAssetMeta = {
  assetId: string;
  assetUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "audio";
};

export async function ensureAssetsDir() {
  await fs.mkdir(ASSETS_DIR, { recursive: true });
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
      error: `不支持的文件扩展名：${ext || "（无）"}。图片支持 JPG/PNG/WEBP，音频支持 MP3/WAV/M4A`,
    };
  }

  if (IMAGE_MIME.has(mimeType)) {
    if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
      return { error: "图片 MIME 类型与扩展名不匹配" };
    }
    return { kind: "image", ext: EXT_BY_MIME[mimeType] ?? ".jpg" };
  }

  if (AUDIO_MIME.has(mimeType)) {
    if (![".mp3", ".wav", ".m4a"].includes(ext)) {
      return { error: "音频 MIME 类型与扩展名不匹配" };
    }
    return { kind: "audio", ext: EXT_BY_MIME[mimeType] ?? ".mp3" };
  }

  return {
    error: `不支持的文件类型：${mimeType || "未知"}。图片支持 JPG/PNG/WEBP，音频支持 MP3/WAV/M4A`,
  };
}

export async function saveAssetFile(params: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  kind: "image" | "audio";
  ext: string;
}): Promise<StoredAssetMeta> {
  await ensureAssetsDir();

  const assetId = randomUUID();
  // 禁止使用用户原始文件名作为磁盘文件名，防止路径穿越
  const diskName = `${assetId}${params.ext}`;
  const diskPath = path.join(ASSETS_DIR, diskName);
  const resolved = path.resolve(diskPath);
  if (!resolved.startsWith(path.resolve(ASSETS_DIR) + path.sep)) {
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

export async function resolveAssetPath(
  assetId: string,
): Promise<{ filePath: string; mimeType: string } | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(assetId)) {
    return null;
  }

  await ensureAssetsDir();
  const entries = await fs.readdir(ASSETS_DIR);
  const match = entries.find((name) => name.startsWith(`${assetId}.`));
  if (!match) return null;

  const filePath = path.join(ASSETS_DIR, match);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(ASSETS_DIR) + path.sep)) {
    return null;
  }

  const ext = path.extname(match).toLowerCase();
  const mimeType =
    Object.entries(EXT_BY_MIME).find(([, e]) => e === ext)?.[0] ??
    "application/octet-stream";

  return { filePath: resolved, mimeType };
}
