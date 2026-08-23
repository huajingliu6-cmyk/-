import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  deleteRemoteBlob,
  isRemoteDataOnly,
} from "@/persistence/remote-data-client";
import { MATERIAL_BLOB_PREFIX } from "@/materials/constants";
import { loadMaterialCatalog } from "@/materials/catalog-store";

function localBlobDir(): string {
  return resolveAppDataPath(MATERIAL_BLOB_PREFIX, "blobs");
}

function localBlobPath(mediaId: string): string {
  return path.join(localBlobDir(), mediaId);
}

function localMetaPath(mediaId: string): string {
  return `${localBlobPath(mediaId)}.meta.json`;
}

function remoteStorageKey(mediaId: string): string {
  return `${MATERIAL_BLOB_PREFIX}/${mediaId}`;
}

export async function isMaterialMediaReferenced(
  mediaId: string,
): Promise<boolean> {
  const id = mediaId.trim();
  if (!id) return false;
  const catalog = await loadMaterialCatalog();
  return catalog.materials.some((item) => item.mediaId === id);
}

/** Delete a media blob only when no catalog row references it (orphan cleanup). */
export async function deleteOrphanMaterialMedia(
  mediaId: string,
): Promise<{ deleted: boolean; reason?: string }> {
  const id = mediaId.trim();
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
    return { deleted: false, reason: "无效媒体 ID" };
  }
  if (await isMaterialMediaReferenced(id)) {
    return { deleted: false, reason: "媒体仍被素材引用" };
  }

  if (isRemoteDataOnly()) {
    try {
      await deleteRemoteBlob(remoteStorageKey(id));
    } catch {
      /* missing remote blob is fine */
    }
    return { deleted: true };
  }

  try {
    await fs.unlink(localBlobPath(id));
  } catch {
    /* ignore */
  }
  try {
    await fs.unlink(localMetaPath(id));
  } catch {
    /* ignore */
  }
  return { deleted: true };
}
