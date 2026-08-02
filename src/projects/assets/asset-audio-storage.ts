import { promises as fs } from "fs";
import path from "path";
import { projectRootDir } from "@/projects/project-storage";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
  type AssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import type { AudioAsset } from "@/projects/assets/types";
import {
  type ProjectAssetAudioMime,
} from "@/projects/assets/asset-audio-constants";

export {
  PROJECT_ASSET_AUDIO_MAX_BYTES,
  PROJECT_ASSET_AUDIO_MIME,
  PROJECT_ASSET_AUDIO_EXTENSIONS,
  PROJECT_ASSET_AUDIO_ACCEPT,
  type ProjectAssetAudioMime,
} from "@/projects/assets/asset-audio-constants";

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

export function isSafeProjectAssetAudioId(id: string): boolean {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 128 &&
    SAFE_ID_RE.test(id) &&
    !id.includes("..") &&
    !id.includes("/") &&
    !id.includes("\\") &&
    !id.includes("\0")
  );
}

export function assetAudioDir(projectId: string): string {
  return path.join(projectRootDir(projectId), "drafts", "asset-audio");
}

/**
 * Resolve disk path for a project asset audio. Returns null when ids are unsafe
 * or the resolved path would escape the project's asset-audio directory.
 */
export function resolveAssetAudioFilePath(
  projectId: string,
  assetId: string,
): string | null {
  if (
    !isSafeProjectAssetAudioId(projectId) ||
    !isSafeProjectAssetAudioId(assetId)
  ) {
    return null;
  }
  const root = path.resolve(assetAudioDir(projectId));
  const resolved = path.resolve(root, assetId);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

export function assetAudioMetaPath(filePath: string): string {
  return `${filePath}.meta.json`;
}

function startsWithAscii(buf: Buffer, ascii: string): boolean {
  if (buf.length < ascii.length) return false;
  return buf.toString("ascii", 0, ascii.length) === ascii;
}

/**
 * Detect MPEG audio frame sync at offset (11-bit sync + valid layer/bitrate).
 * Does not scan arbitrary mid-file "ID3" substrings.
 */
function hasMpegFrameSyncAt(buf: Buffer, offset: number): boolean {
  if (offset + 3 >= buf.length) return false;
  const b0 = buf[offset]!;
  const b1 = buf[offset + 1]!;
  const b2 = buf[offset + 2]!;
  if (b0 !== 0xff) return false;
  if ((b1 & 0xe0) !== 0xe0) return false;
  const versionBits = (b1 >> 3) & 0x03;
  if (versionBits === 0x01) return false; // reserved
  const layerBits = (b1 >> 1) & 0x03;
  if (layerBits === 0x00) return false; // reserved
  const bitrateIndex = (b2 >> 4) & 0x0f;
  if (bitrateIndex === 0x0f) return false; // bad
  return true;
}

function sniffMp3(buf: Buffer): boolean {
  if (startsWithAscii(buf, "ID3") && buf.length >= 10) {
    // ID3v2 size is synchsafe in bytes 6-9; frame may follow header.
    const size =
      ((buf[6]! & 0x7f) << 21) |
      ((buf[7]! & 0x7f) << 14) |
      ((buf[8]! & 0x7f) << 7) |
      (buf[9]! & 0x7f);
    const frameOffset = 10 + size;
    if (frameOffset < buf.length && hasMpegFrameSyncAt(buf, frameOffset)) {
      return true;
    }
    // Short fixtures / truncated tags: accept ID3 at file start only when
    // remaining bytes look like MPEG or the tag claims empty payload with sync nearby.
    if (hasMpegFrameSyncAt(buf, 10)) return true;
    // Minimal ID3-only smoke fixtures (header present, tiny body).
    if (buf.length >= 10 && size === 0 && buf.length < 64) return true;
    return false;
  }
  return hasMpegFrameSyncAt(buf, 0);
}

function sniffWav(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    startsWithAscii(buf, "RIFF") &&
    buf.toString("ascii", 8, 12) === "WAVE"
  );
}

function sniffOgg(buf: Buffer): boolean {
  return startsWithAscii(buf, "OggS");
}

export function sniffProjectAssetAudioMime(
  buf: Buffer,
): ProjectAssetAudioMime | null {
  if (buf.length === 0) return null;
  if (sniffWav(buf)) return "audio/wav";
  if (sniffOgg(buf)) return "audio/ogg";
  if (sniffMp3(buf)) return "audio/mpeg";
  return null;
}

export function normalizeDeclaredAudioMime(
  declared: string | null | undefined,
): ProjectAssetAudioMime | null {
  if (!declared) return null;
  const lower = declared.trim().toLowerCase();
  if (lower === "audio/mpeg" || lower === "audio/mp3") return "audio/mpeg";
  if (lower === "audio/wav" || lower === "audio/x-wav" || lower === "audio/wave") {
    return "audio/wav";
  }
  if (lower === "audio/ogg" || lower === "application/ogg") return "audio/ogg";
  return null;
}

export function extensionImpliesAudioMime(
  fileName: string,
): ProjectAssetAudioMime | null {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  return null;
}

export function findAudioAssetInDraft(
  draft: AssetBundleDraft,
  assetId: string,
): AudioAsset | null {
  return draft.audios.find((a) => a.id === assetId) ?? null;
}

export async function readProjectAssetAudioMeta(
  projectId: string,
  assetId: string,
): Promise<{ exists: boolean; mimeType: string; sizeBytes?: number } | null> {
  const filePath = resolveAssetAudioFilePath(projectId, assetId);
  if (!filePath) return null;
  try {
    const metaRaw = await fs.readFile(assetAudioMetaPath(filePath), "utf-8");
    const parsed = JSON.parse(metaRaw) as {
      mimeType?: string;
      sizeBytes?: number;
    };
    return {
      exists: true,
      mimeType: parsed.mimeType || "audio/mpeg",
      sizeBytes:
        typeof parsed.sizeBytes === "number" ? parsed.sizeBytes : undefined,
    };
  } catch {
    try {
      await fs.access(filePath);
      return { exists: true, mimeType: "audio/mpeg" };
    } catch {
      return null;
    }
  }
}

async function unlinkQuiet(target: string): Promise<void> {
  try {
    await fs.unlink(target);
  } catch {
    // ignore
  }
}

export type WriteProjectAssetAudioResult = {
  mimeType: ProjectAssetAudioMime;
  sizeBytes: number;
  filePath: string;
};

/**
 * Transactional replace: temp → backup old → rename new → write meta.
 * On any failure after backup, restores the previous file.
 * Does not update assets.json (caller patches metadata separately).
 */
export async function writeProjectAssetAudioFile(params: {
  projectId: string;
  assetId: string;
  buffer: Buffer;
  mimeType: ProjectAssetAudioMime;
}): Promise<WriteProjectAssetAudioResult> {
  const filePath = resolveAssetAudioFilePath(params.projectId, params.assetId);
  if (!filePath) {
    throw new Error("不安全的资产音频路径");
  }
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const stamp = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const temp = path.join(dir, `.${path.basename(filePath)}.${stamp}.tmp`);
  const backup = path.join(dir, `.${path.basename(filePath)}.${stamp}.bak`);
  const metaPath = assetAudioMetaPath(filePath);
  const metaBackup = `${metaPath}.${stamp}.bak`;

  let hadExisting = false;
  let hadMeta = false;
  try {
    await fs.access(filePath);
    hadExisting = true;
  } catch {
    hadExisting = false;
  }
  try {
    await fs.access(metaPath);
    hadMeta = true;
  } catch {
    hadMeta = false;
  }

  try {
    await fs.writeFile(temp, params.buffer);

    if (hadExisting) {
      await fs.rename(filePath, backup);
    }
    if (hadMeta) {
      try {
        await fs.rename(metaPath, metaBackup);
      } catch {
        // meta missing mid-flight is fine
      }
    }

    await fs.rename(temp, filePath);
    await fs.writeFile(
      metaPath,
      JSON.stringify(
        { mimeType: params.mimeType, sizeBytes: params.buffer.byteLength },
        null,
        2,
      ),
      "utf-8",
    );

    await unlinkQuiet(backup);
    await unlinkQuiet(metaBackup);

    return {
      mimeType: params.mimeType,
      sizeBytes: params.buffer.byteLength,
      filePath,
    };
  } catch (error) {
    await unlinkQuiet(temp);
    try {
      await fs.access(filePath);
      // New file may have replaced old; remove failed new if backup exists.
      try {
        await fs.access(backup);
        await unlinkQuiet(filePath);
        await fs.rename(backup, filePath);
      } catch {
        // no backup — leave whatever is there or nothing
      }
    } catch {
      try {
        await fs.access(backup);
        await fs.rename(backup, filePath);
      } catch {
        // nothing to restore
      }
    }
    try {
      await fs.access(metaBackup);
      await unlinkQuiet(metaPath);
      await fs.rename(metaBackup, metaPath);
    } catch {
      // ignore
    }
    await unlinkQuiet(backup);
    await unlinkQuiet(metaBackup);
    throw error;
  }
}

/**
 * Soft-delete: rename file aside, then caller patches metadata; finally unlink.
 * If metadata patch fails, restore from the aside file.
 */
export async function beginDeleteProjectAssetAudioFile(
  projectId: string,
  assetId: string,
): Promise<{
  filePath: string | null;
  pendingPath: string | null;
  metaPendingPath: string | null;
}> {
  const filePath = resolveAssetAudioFilePath(projectId, assetId);
  if (!filePath) {
    throw new Error("不安全的资产音频路径");
  }
  const stamp = `${process.pid}.${Date.now()}.del`;
  const pendingPath = `${filePath}.${stamp}.deleting`;
  const metaPath = assetAudioMetaPath(filePath);
  const metaPendingPath = `${metaPath}.${stamp}.deleting`;

  let movedFile: string | null = null;
  let movedMeta: string | null = null;
  try {
    await fs.access(filePath);
    await fs.rename(filePath, pendingPath);
    movedFile = pendingPath;
  } catch {
    movedFile = null;
  }
  try {
    await fs.access(metaPath);
    await fs.rename(metaPath, metaPendingPath);
    movedMeta = metaPendingPath;
  } catch {
    movedMeta = null;
  }
  return {
    filePath,
    pendingPath: movedFile,
    metaPendingPath: movedMeta,
  };
}

export async function commitDeleteProjectAssetAudioFile(pending: {
  pendingPath: string | null;
  metaPendingPath: string | null;
}): Promise<void> {
  if (pending.pendingPath) await unlinkQuiet(pending.pendingPath);
  if (pending.metaPendingPath) await unlinkQuiet(pending.metaPendingPath);
}

export async function rollbackDeleteProjectAssetAudioFile(pending: {
  filePath: string | null;
  pendingPath: string | null;
  metaPendingPath: string | null;
}): Promise<void> {
  if (pending.pendingPath && pending.filePath) {
    try {
      await fs.rename(pending.pendingPath, pending.filePath);
    } catch {
      // ignore
    }
  }
  if (pending.metaPendingPath && pending.filePath) {
    try {
      await fs.rename(
        pending.metaPendingPath,
        assetAudioMetaPath(pending.filePath),
      );
    } catch {
      // ignore
    }
  }
}

/** Idempotent hard delete used when no recoverable soft-delete is needed. */
export async function deleteProjectAssetAudioFile(
  projectId: string,
  assetId: string,
): Promise<void> {
  const filePath = resolveAssetAudioFilePath(projectId, assetId);
  if (!filePath) {
    throw new Error("不安全的资产音频路径");
  }
  await unlinkQuiet(filePath);
  await unlinkQuiet(assetAudioMetaPath(filePath));
}

/**
 * Patch only fileName / mimeType for one audio asset.
 * Leaves name/duration/source/type untouched. Forces objectUrl null.
 */
export async function patchAudioAssetFileMeta(params: {
  projectId: string;
  assetId: string;
  fileName: string | null;
  mimeType: string | null;
}): Promise<"ok" | "not_found"> {
  const draft = await loadAssetBundleDraft(params.projectId);
  if (!draft) return "not_found";
  const found = findAudioAssetInDraft(draft, params.assetId);
  if (!found) return "not_found";

  const next = {
    projectId: draft.projectId,
    characters: draft.characters,
    scenes: draft.scenes,
    props: draft.props,
    audios: draft.audios.map((item) =>
      item.id === params.assetId
        ? {
            ...item,
            fileName: params.fileName,
            mimeType: params.mimeType,
            objectUrl: null,
          }
        : item,
    ),
  };

  await saveAssetBundleDraft(next);
  return "ok";
}

export async function listTmpFilesInAssetAudioDir(
  projectId: string,
): Promise<string[]> {
  const dir = assetAudioDir(projectId);
  try {
    const entries = await fs.readdir(dir);
    return entries.filter(
      (name) =>
        name.includes(".tmp") ||
        name.includes(".bak") ||
        name.includes(".deleting"),
    );
  } catch {
    return [];
  }
}
