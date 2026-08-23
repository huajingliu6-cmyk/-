import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  deleteProjectAssetImageFile,
  isSafeProjectAssetImageId,
  readProjectAssetImageFile,
  writeProjectAssetImageFile,
  type ProjectAssetImageMime,
  assetImagesDir,
} from "@/projects/assets/asset-image-storage";
import {
  isTempReferenceStorageKey,
  TEMP_REFERENCE_PREFIX,
} from "@/projects/assets/image-generation/types";
import type { ParsedGenerateAssetReferenceImage } from "@/projects/assets/episode-design/parse-generate-asset-request";

export type TempReferenceMeta = {
  storageKey: string;
  projectId: string;
  createdAt: string;
  sizeBytes: number;
  mimeType: ProjectAssetImageMime;
  fileName: string | null;
};

function metaPath(projectId: string, storageKey: string): string {
  return path.join(assetImagesDir(projectId), `${storageKey}.tmpref.json`);
}

export function createTempReferenceStorageKey(): string {
  return `${TEMP_REFERENCE_PREFIX}${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/**
 * Persist a reference image into the temp-reference namespace (`tmpref_*`).
 * Never writes Base64 into job JSON — only the storage key is stored on jobs.
 *
 * Remote (REMOTE_DATA_ONLY / production): blob bytes go through remote asset
 * storage; local `.tmpref.json` sidecar is skipped (would throw
 * LOCAL_PERSISTENCE_FORBIDDEN via projectRootDir).
 */
export async function writeTempReferenceImage(input: {
  projectId: string;
  buffer: Buffer;
  mimeType: ProjectAssetImageMime;
  fileName?: string | null;
}): Promise<TempReferenceMeta> {
  const storageKey = createTempReferenceStorageKey();
  if (!isSafeProjectAssetImageId(storageKey) || !isTempReferenceStorageKey(storageKey)) {
    throw new Error("无法分配临时参考图 ID");
  }
  await writeProjectAssetImageFile({
    projectId: input.projectId,
    assetId: storageKey,
    buffer: input.buffer,
    mimeType: input.mimeType,
  });
  const meta: TempReferenceMeta = {
    storageKey,
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
    sizeBytes: input.buffer.byteLength,
    mimeType: input.mimeType,
    fileName: input.fileName ?? null,
  };
  if (!isRemoteDataOnly()) {
    await fs.mkdir(assetImagesDir(input.projectId), { recursive: true });
    await fs.writeFile(
      metaPath(input.projectId, storageKey),
      JSON.stringify(meta, null, 2),
      "utf8",
    );
  }
  return meta;
}

export async function readTempReferenceMeta(
  projectId: string,
  storageKey: string,
): Promise<TempReferenceMeta | null> {
  if (!isTempReferenceStorageKey(storageKey)) return null;
  if (isRemoteDataOnly()) {
    const file = await readProjectAssetImageFile(projectId, storageKey);
    if (!file) return null;
    return {
      storageKey,
      projectId,
      createdAt: new Date(0).toISOString(),
      sizeBytes: file.buffer.byteLength,
      mimeType: file.mimeType,
      fileName: file.fileName,
    };
  }
  try {
    const raw = await fs.readFile(metaPath(projectId, storageKey), "utf8");
    const parsed = JSON.parse(raw) as TempReferenceMeta;
    if (parsed.storageKey !== storageKey || parsed.projectId !== projectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadReferenceImagesFromStorageKeys(input: {
  projectId: string;
  keys: string[];
}): Promise<
  | { ok: true; images: ParsedGenerateAssetReferenceImage[] }
  | { ok: false; code: "REFERENCE_IMAGE_REQUIRED"; message: string }
> {
  const images: ParsedGenerateAssetReferenceImage[] = [];
  for (const key of input.keys) {
    if (!isSafeProjectAssetImageId(key)) {
      return {
        ok: false,
        code: "REFERENCE_IMAGE_REQUIRED",
        message: "参考图缺失或无效，请重新选择参考图后再试。",
      };
    }
    const file = await readProjectAssetImageFile(input.projectId, key);
    if (!file) {
      return {
        ok: false,
        code: "REFERENCE_IMAGE_REQUIRED",
        message: "参考图缺失或无效，请重新选择参考图后再试。",
      };
    }
    images.push({
      buffer: file.buffer,
      mimeType: file.mimeType,
      fileName: file.fileName || `${key}.png`,
    });
  }
  return { ok: true, images };
}

export async function listTempReferenceImages(
  projectId: string,
): Promise<TempReferenceMeta[]> {
  // Remote deployments have no local asset-images directory; quota uses an
  // empty list (blob GC is separate). Avoid projectRootDir / LOCAL_PERSISTENCE.
  if (isRemoteDataOnly()) {
    return [];
  }
  const dir = assetImagesDir(projectId);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: TempReferenceMeta[] = [];
  for (const name of names) {
    if (!name.endsWith(".tmpref.json")) continue;
    const key = name.replace(/\.tmpref\.json$/, "");
    if (!isTempReferenceStorageKey(key)) continue;
    const meta = await readTempReferenceMeta(projectId, key);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteTempReferenceImage(input: {
  projectId: string;
  storageKey: string;
}): Promise<
  | { ok: true }
  | { ok: false; code: string; message: string; status: number }
> {
  if (!isTempReferenceStorageKey(input.storageKey)) {
    return {
      ok: false,
      code: "FORBIDDEN_STORAGE_KEY",
      message: "只能删除临时参考图，不能删除正式资产文件。",
      status: 403,
    };
  }
  if (!isSafeProjectAssetImageId(input.storageKey)) {
    return {
      ok: false,
      code: "INVALID_STORAGE_KEY",
      message: "无效的临时参考图标识。",
      status: 400,
    };
  }
  await deleteProjectAssetImageFile(input.projectId, input.storageKey).catch(
    () => undefined,
  );
  if (!isRemoteDataOnly()) {
    await fs
      .unlink(metaPath(input.projectId, input.storageKey))
      .catch(() => undefined);
  }
  return { ok: true };
}

/**
 * Persist upload buffers as temp refs; keep library media ids as-is.
 * When every reference is already a durable library media id, skip temp copies
 * (avoids redundant blobs and local sidecar writes in remote mode).
 */
export async function persistEnqueueReferenceImages(input: {
  projectId: string;
  referenceImages: ParsedGenerateAssetReferenceImage[];
  libraryReferenceMediaIds: string[];
}): Promise<{
  referenceStorageKeys: string[];
  libraryReferenceMediaIds: string[];
}> {
  const libraryReferenceMediaIds = [...input.libraryReferenceMediaIds];
  if (
    libraryReferenceMediaIds.length > 0 &&
    libraryReferenceMediaIds.length === input.referenceImages.length
  ) {
    return {
      referenceStorageKeys: [],
      libraryReferenceMediaIds,
    };
  }
  const keys: string[] = [];
  for (const image of input.referenceImages) {
    const meta = await writeTempReferenceImage({
      projectId: input.projectId,
      buffer: image.buffer,
      mimeType: image.mimeType,
      fileName: image.fileName,
    });
    keys.push(meta.storageKey);
  }
  return {
    referenceStorageKeys: keys,
    libraryReferenceMediaIds,
  };
}
