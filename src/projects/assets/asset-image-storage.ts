import { promises as fs } from "fs";
import path from "path";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { projectRootDir } from "@/projects/project-storage";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
  type AssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import type {
  CharacterAsset,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import { type ProjectAssetImageMime } from "@/projects/assets/asset-image-constants";
import {
  deleteRemoteAssetImage,
  getRemoteAssetImage,
  imageStorageKey,
  putRemoteAssetImage,
} from "@/projects/assets/remote-asset-blob-store";

export {
  PROJECT_ASSET_IMAGE_MAX_BYTES,
  PROJECT_ASSET_IMAGE_MIME,
  type ProjectAssetImageMime,
} from "@/projects/assets/asset-image-constants";

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

export type ImageableAssetKind = "character" | "scene" | "prop";

export type ImageableAssetRef = {
  kind: ImageableAssetKind;
  asset: CharacterAsset | SceneAsset | PropAsset;
};

export function isSafeProjectAssetImageId(id: string): boolean {
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

export function assetImagesDir(projectId: string): string {
  return path.join(projectRootDir(projectId), "drafts", "asset-images");
}

/**
 * Resolve disk path for a project asset image. Returns null when ids are unsafe
 * or the resolved path would escape the project's asset-images directory.
 */
export function resolveAssetImageFilePath(
  projectId: string,
  assetId: string,
): string | null {
  if (!isSafeProjectAssetImageId(projectId) || !isSafeProjectAssetImageId(assetId)) {
    return null;
  }
  const root = path.resolve(assetImagesDir(projectId));
  const resolved = path.resolve(root, assetId);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

/** @deprecated Prefer resolveAssetImageFilePath — kept for callers that assume join-only. */
export function assetImageFilePath(projectId: string, assetId: string): string {
  const resolved = resolveAssetImageFilePath(projectId, assetId);
  if (!resolved) {
    throw new Error("不安全的资产图片路径");
  }
  return resolved;
}

export function assetImageMetaPath(filePath: string): string {
  return `${filePath}.meta.json`;
}

function startsWithBytes(buf: Buffer, magic: number[]): boolean {
  if (buf.length < magic.length) return false;
  return magic.every((b, i) => buf[i] === b);
}

export function sniffProjectAssetImageMime(
  buf: Buffer,
): ProjectAssetImageMime | null {
  if (startsWithBytes(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWithBytes(buf, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function normalizeDeclaredImageMime(
  declared: string | null | undefined,
): ProjectAssetImageMime | null {
  if (!declared) return null;
  const lower = declared.trim().toLowerCase();
  if (lower === "image/jpg") return "image/jpeg";
  if (
    lower === "image/png" ||
    lower === "image/jpeg" ||
    lower === "image/webp"
  ) {
    return lower;
  }
  return null;
}

export function findImageableAssetInDraft(
  draft: AssetBundleDraft,
  assetId: string,
): ImageableAssetRef | null {
  const character = draft.characters.find((c) => c.id === assetId);
  if (character) return { kind: "character", asset: character };
  const scene = draft.scenes.find((s) => s.id === assetId);
  if (scene) return { kind: "scene", asset: scene };
  const prop = draft.props.find((p) => p.id === assetId);
  if (prop) return { kind: "prop", asset: prop };
  return null;
}

export async function readProjectAssetImageMeta(
  projectId: string,
  assetId: string,
): Promise<{ exists: boolean; mimeType: string } | null> {
  const filePath = resolveAssetImageFilePath(projectId, assetId);
  if (!filePath) return null;
  try {
    const metaRaw = await fs.readFile(assetImageMetaPath(filePath), "utf-8");
    const parsed = JSON.parse(metaRaw) as { mimeType?: string };
    return {
      exists: true,
      mimeType: parsed.mimeType || "image/png",
    };
  } catch {
    try {
      await fs.access(filePath);
      return { exists: true, mimeType: "image/png" };
    } catch {
      return null;
    }
  }
}

function extensionForProjectAssetImageMime(
  mimeType: ProjectAssetImageMime,
): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

/**
 * Read design / draft asset image bytes (local disk or remote blob).
 * Returns null when the id is unsafe or the file is missing.
 */
export async function readProjectAssetImageFile(
  projectId: string,
  mediaId: string,
): Promise<{
  buffer: Buffer;
  mimeType: ProjectAssetImageMime;
  fileName: string;
} | null> {
  if (isRemoteDataOnly()) {
    if (!isSafeProjectAssetImageId(projectId) || !isSafeProjectAssetImageId(mediaId)) {
      return null;
    }
    const blob = await getRemoteAssetImage(projectId, mediaId);
    if (!blob) return null;
    const sniffed = sniffProjectAssetImageMime(blob.body);
    const declared = normalizeDeclaredImageMime(blob.contentType);
    const mimeType = sniffed ?? declared ?? "image/png";
    return {
      buffer: blob.body,
      mimeType,
      fileName: `${mediaId}.${extensionForProjectAssetImageMime(mimeType)}`,
    };
  }

  const filePath = resolveAssetImageFilePath(projectId, mediaId);
  if (!filePath) return null;
  try {
    const buffer = await fs.readFile(filePath);
    const meta = await readProjectAssetImageMeta(projectId, mediaId);
    const sniffed = sniffProjectAssetImageMime(buffer);
    const declared = normalizeDeclaredImageMime(meta?.mimeType);
    const mimeType = sniffed ?? declared ?? "image/png";
    return {
      buffer,
      mimeType,
      fileName: `${mediaId}.${extensionForProjectAssetImageMime(mimeType)}`,
    };
  } catch {
    return null;
  }
}

async function atomicWriteBinary(target: string, data: Buffer): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const temp = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await fs.writeFile(temp, data);
    await fs.rename(temp, target);
  } catch (error) {
    try {
      await fs.unlink(temp);
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
}

async function atomicWriteText(target: string, contents: string): Promise<void> {
  await atomicWriteBinary(target, Buffer.from(contents, "utf-8"));
}

export type WriteProjectAssetImageResult = {
  mimeType: ProjectAssetImageMime;
  sizeBytes: number;
  filePath: string;
};

/**
 * Atomically replace the image bytes for an assetId. On failure, previous file
 * (if any) remains. Does not update assets.json.
 */
export async function writeProjectAssetImageFile(params: {
  projectId: string;
  assetId: string;
  buffer: Buffer;
  mimeType: ProjectAssetImageMime;
}): Promise<WriteProjectAssetImageResult> {
  if (isRemoteDataOnly()) {
    await putRemoteAssetImage({
      projectId: params.projectId,
      assetId: params.assetId,
      mimeType: params.mimeType,
      body: params.buffer,
    });
    return {
      mimeType: params.mimeType,
      sizeBytes: params.buffer.byteLength,
      filePath: imageStorageKey(params.projectId, params.assetId),
    };
  }
  const filePath = resolveAssetImageFilePath(params.projectId, params.assetId);
  if (!filePath) {
    throw new Error("不安全的资产图片路径");
  }
  await atomicWriteBinary(filePath, params.buffer);
  await atomicWriteText(
    assetImageMetaPath(filePath),
    JSON.stringify({ mimeType: params.mimeType }, null, 2),
  );
  return {
    mimeType: params.mimeType,
    sizeBytes: params.buffer.byteLength,
    filePath,
  };
}

export async function deleteProjectAssetImageFile(
  projectId: string,
  assetId: string,
): Promise<void> {
  if (isRemoteDataOnly()) {
    await deleteRemoteAssetImage(projectId, assetId);
    return;
  }
  const filePath = resolveAssetImageFilePath(projectId, assetId);
  if (!filePath) {
    throw new Error("不安全的资产图片路径");
  }
  try {
    await fs.unlink(filePath);
  } catch {
    // missing file is fine
  }
  try {
    await fs.unlink(assetImageMetaPath(filePath));
  } catch {
    // missing meta is fine
  }
}

/**
 * Patch only imageFileName / imageMimeType for one imageable asset.
 * Leaves name/description/other fields untouched.
 * Clears videoRefSafety so a new precheck is required after image change.
 */
export async function patchImageableAssetImageMeta(params: {
  projectId: string;
  assetId: string;
  imageFileName: string | null;
  imageMimeType: string | null;
}): Promise<"ok" | "not_found"> {
  const draft = await loadAssetBundleDraft(params.projectId);
  if (!draft) return "not_found";
  const found = findImageableAssetInDraft(draft, params.assetId);
  if (!found) return "not_found";

  const apply = <T extends CharacterAsset | SceneAsset | PropAsset>(
    item: T,
  ): T =>
    item.id === params.assetId
      ? {
          ...item,
          imageFileName: params.imageFileName,
          imageMimeType: params.imageMimeType,
          imageObjectUrl: null,
          videoRefSafety: null,
        }
      : item;

  const next = {
    projectId: draft.projectId,
    characters:
      found.kind === "character"
        ? draft.characters.map(apply)
        : draft.characters,
    scenes: found.kind === "scene" ? draft.scenes.map(apply) : draft.scenes,
    props: found.kind === "prop" ? draft.props.map(apply) : draft.props,
    audios: draft.audios,
  };

  await saveAssetBundleDraft(next);
  return "ok";
}

/**
 * Persist video reference safety precheck result for one imageable asset.
 */
export async function patchImageableAssetVideoRefSafety(params: {
  projectId: string;
  assetId: string;
  videoRefSafety: import("@/projects/assets/types").VideoRefSafety | null;
}): Promise<"ok" | "not_found"> {
  const draft = await loadAssetBundleDraft(params.projectId);
  if (!draft) return "not_found";
  const found = findImageableAssetInDraft(draft, params.assetId);
  if (!found) return "not_found";

  const apply = <T extends CharacterAsset | SceneAsset | PropAsset>(
    item: T,
  ): T =>
    item.id === params.assetId
      ? { ...item, videoRefSafety: params.videoRefSafety }
      : item;

  const next = {
    projectId: draft.projectId,
    characters:
      found.kind === "character"
        ? draft.characters.map(apply)
        : draft.characters,
    scenes: found.kind === "scene" ? draft.scenes.map(apply) : draft.scenes,
    props: found.kind === "prop" ? draft.props.map(apply) : draft.props,
    audios: draft.audios,
  };

  await saveAssetBundleDraft(next);
  return "ok";
}

export async function listTmpFilesInAssetImagesDir(
  projectId: string,
): Promise<string[]> {
  const dir = assetImagesDir(projectId);
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((name) => name.includes(".tmp"));
  } catch {
    return [];
  }
}
