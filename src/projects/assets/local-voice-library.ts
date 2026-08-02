import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { VoiceOption } from "@/projects/assets/types";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  decodeLocalVoiceId,
  encodeLocalVoiceId,
  localVoiceDisplayName,
} from "@/projects/assets/local-voice-id";

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac"]);
const MAX_VOICE_BYTES = 50 * 1024 * 1024;

export type LocalVoiceLibraryEntry = VoiceOption & {
  fileName: string;
  sizeBytes: number;
};

export function getLocalVoiceLibraryDir(): string {
  const fromEnv = process.env.LOCAL_VOICE_LIBRARY_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), "Desktop", "本地音频库");
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
    case ".aac":
      return "audio/mp4";
    default:
      return "audio/mpeg";
  }
}

function isSafeLibraryFileName(fileName: string): boolean {
  if (!fileName || fileName.includes("\0")) return false;
  if (fileName.includes("/") || fileName.includes("\\")) return false;
  if (fileName === "." || fileName === ".." || fileName.includes("..")) {
    return false;
  }
  const ext = path.extname(fileName).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

/**
 * Resolve a localvoice_* id to an absolute file path under the library root.
 * Rejects path traversal.
 */
export async function resolveLocalVoiceFile(
  voiceId: string,
): Promise<{ absolutePath: string; fileName: string; mimeType: string } | null> {
  if (isRemoteDataOnly()) return null;
  const fileName = decodeLocalVoiceId(voiceId);
  if (!fileName || !isSafeLibraryFileName(fileName)) return null;

  const root = path.resolve(getLocalVoiceLibraryDir());
  const absolute = path.resolve(root, fileName);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    return null;
  }

  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  return {
    absolutePath: absolute,
    fileName,
    mimeType: mimeFromExt(path.extname(fileName).toLowerCase()),
  };
}

export async function listLocalVoiceLibrary(): Promise<LocalVoiceLibraryEntry[]> {
  if (isRemoteDataOnly()) return [];
  const root = getLocalVoiceLibraryDir();
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return [];
  }

  const entries: LocalVoiceLibraryEntry[] = [];
  for (const name of names) {
    if (!isSafeLibraryFileName(name)) continue;
    const absolute = path.join(root, name);
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) continue;
      const display = localVoiceDisplayName(name);
      entries.push({
        id: encodeLocalVoiceId(name),
        name: display,
        label: display,
        style: `本地音频库·${name}`,
        fileName: name,
        sizeBytes: stat.size,
      });
    } catch {
      // skip unreadable entries
    }
  }

  entries.sort((a, b) =>
    a.fileName.localeCompare(b.fileName, "zh-CN", { numeric: true }),
  );
  return entries;
}

export async function readLocalVoiceAsDataUrl(
  voiceId: string,
): Promise<{ dataUrl: string; mimeType: string; fileName: string }> {
  const resolved = await resolveLocalVoiceFile(voiceId);
  if (!resolved) {
    throw new Error("本地音色文件不存在或路径无效");
  }
  const buffer = await fs.readFile(resolved.absolutePath);
  if (buffer.byteLength > MAX_VOICE_BYTES) {
    throw new Error("本地音色文件超过 50MB，无法发送给模型");
  }
  return {
    dataUrl: `data:${resolved.mimeType};base64,${buffer.toString("base64")}`,
    mimeType: resolved.mimeType,
    fileName: resolved.fileName,
  };
}
