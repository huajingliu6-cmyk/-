import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  getRemoteBlob,
  isRemoteDataOnly,
  putRemoteBlob,
} from "@/persistence/remote-data-client";
import {
  MATERIAL_BLOB_PREFIX,
  type MaterialImageMime,
} from "@/materials/constants";
import {
  sniffMaterialImageMime,
  validateMaterialImageUpload,
} from "@/materials/media-validation";

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

export async function saveMaterialMedia(input: {
  buffer: Buffer;
  declaredMime?: string | null;
}): Promise<{ mediaId: string; mime: MaterialImageMime }> {
  const validated = validateMaterialImageUpload(input);
  if (!validated.ok) throw new Error(validated.error);

  const mediaId = randomUUID().replace(/-/g, "");
  if (isRemoteDataOnly()) {
    await putRemoteBlob({
      storageKey: remoteStorageKey(mediaId),
      contentType: validated.mime,
      body: input.buffer,
    });
    return { mediaId, mime: validated.mime };
  }

  await fs.mkdir(localBlobDir(), { recursive: true });
  await fs.writeFile(localBlobPath(mediaId), input.buffer);
  await fs.writeFile(
    localMetaPath(mediaId),
    JSON.stringify({ mime: validated.mime }, null, 2),
    "utf-8",
  );
  return { mediaId, mime: validated.mime };
}

export async function readMaterialMedia(
  mediaId: string,
): Promise<{ body: Buffer; mime: MaterialImageMime } | null> {
  const id = mediaId.trim();
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
    return null;
  }

  if (isRemoteDataOnly()) {
    const blob = await getRemoteBlob(remoteStorageKey(id));
    if (!blob) return null;
    const sniffed = sniffMaterialImageMime(blob.body);
    return {
      body: blob.body,
      mime: sniffed ?? (blob.contentType as MaterialImageMime),
    };
  }

  try {
    const body = await fs.readFile(localBlobPath(id));
    let mime: MaterialImageMime | null = sniffMaterialImageMime(body);
    try {
      const metaRaw = await fs.readFile(localMetaPath(id), "utf-8");
      const meta = JSON.parse(metaRaw) as { mime?: string };
      if (
        meta.mime === "image/png" ||
        meta.mime === "image/jpeg" ||
        meta.mime === "image/webp"
      ) {
        mime = meta.mime;
      }
    } catch {
      /* ignore */
    }
    if (!mime) return null;
    return { body, mime };
  } catch {
    return null;
  }
}
