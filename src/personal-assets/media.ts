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
import { MATERIAL_BLOB_PREFIX } from "@/materials/constants";
import { sniffMaterialImageMime } from "@/materials/media-validation";
import { validatePersonalAssetUpload } from "@/personal-assets/validation";
import type { PersonalAssetMimeType } from "@/personal-assets/types";

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

export function personalAssetStorageKey(mediaId: string): string {
  return `${MATERIAL_BLOB_PREFIX}/blobs/${mediaId}`;
}

export async function savePersonalAssetMedia(input: {
  buffer: Buffer;
  declaredMime?: string | null;
}): Promise<{ mediaId: string; mime: PersonalAssetMimeType; storageKey: string }> {
  const validated = validatePersonalAssetUpload(input);
  if (!validated.ok) throw new Error(validated.error);

  const mediaId = randomUUID().replace(/-/g, "");
  if (isRemoteDataOnly()) {
    await putRemoteBlob({
      storageKey: remoteStorageKey(mediaId),
      contentType: validated.mime,
      body: input.buffer,
    });
    return {
      mediaId,
      mime: validated.mime,
      storageKey: personalAssetStorageKey(mediaId),
    };
  }

  await fs.mkdir(localBlobDir(), { recursive: true });
  await fs.writeFile(localBlobPath(mediaId), input.buffer);
  await fs.writeFile(
    localMetaPath(mediaId),
    JSON.stringify({ mime: validated.mime }, null, 2),
    "utf-8",
  );
  return {
    mediaId,
    mime: validated.mime,
    storageKey: personalAssetStorageKey(mediaId),
  };
}

export async function readPersonalAssetMedia(
  storageKey: string,
): Promise<{ body: Buffer; mime: PersonalAssetMimeType } | null> {
  const mediaId = storageKey.replace(/^materials\/blobs\//, "").trim();
  if (!mediaId || mediaId.includes("..") || mediaId.includes("/")) return null;

  if (isRemoteDataOnly()) {
    const blob = await getRemoteBlob(remoteStorageKey(mediaId));
    if (!blob) return null;
    const sniffed = sniffMaterialImageMime(blob.body);
    if (
      sniffed !== "image/png" &&
      sniffed !== "image/jpeg" &&
      sniffed !== "image/webp"
    ) {
      return null;
    }
    return { body: blob.body, mime: sniffed };
  }

  try {
    const body = await fs.readFile(localBlobPath(mediaId));
    const sniffed = sniffMaterialImageMime(body);
    if (
      sniffed !== "image/png" &&
      sniffed !== "image/jpeg" &&
      sniffed !== "image/webp"
    ) {
      return null;
    }
    return { body, mime: sniffed };
  } catch {
    return null;
  }
}
