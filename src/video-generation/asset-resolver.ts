import { promises as fs } from "fs";
import path from "path";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { isLocalVoiceId, getLocalVoiceFileUrl } from "@/projects/assets/local-voice-id";
import { readLocalVoiceAsDataUrl } from "@/projects/assets/local-voice-library";
import {
  normalizeDeclaredAudioMime,
  resolveAssetAudioFilePath,
  readProjectAssetAudioMeta,
} from "@/projects/assets/asset-audio-storage";
import {
  getRemoteAssetAudio,
  getRemoteAssetImage,
} from "@/projects/assets/remote-asset-blob-store";
import { getProjectAssetAudioUrl } from "@/projects/assets/asset-audio-url";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  findImageableAssetInDraft,
  resolveAssetImageFilePath,
  assetImageMetaPath,
  sniffProjectAssetImageMime,
  readProjectAssetImageMeta,
} from "@/projects/assets/asset-image-storage";
import { resolveAssetImageStorageKey } from "@/projects/assets/asset-image-url";
import { readMaterialMedia } from "@/materials/media-store";
import { isLikelyRealPersonForVideoRef } from "@/video-generation/ark-image-safety-precheck";
import type {
  GenerationAssetReference,
  ResolvedProviderMedia,
  VideoGenerationInput,
} from "./types";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VOICE_BYTES = 50 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalhostUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "::1"
    );
  } catch {
    return false;
  }
}

function assetIdFromLocalUrl(url: string): string | null {
  const match = url.match(/\/api\/assets\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function parseProjectDraftImageUrl(
  url: string,
): { projectId: string; assetOrMediaId: string } | null {
  const pathOnly = (() => {
    try {
      if (/^https?:\/\//i.test(url)) return new URL(url).pathname;
    } catch {
      /* ignore */
    }
    return url.split("?")[0] ?? url;
  })();
  const match = pathOnly.match(
    /\/api\/projects\/([^/]+)\/assets-draft\/images\/([^/]+)$/,
  );
  if (!match) return null;
  return {
    projectId: decodeURIComponent(match[1]!),
    assetOrMediaId: decodeURIComponent(match[2]!),
  };
}

async function bufferToImageDataUrl(
  buffer: Buffer,
  preferredMime?: string | null,
): Promise<{ dataUrl: string; mimeType: string }> {
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("参考图片超过 10MB，无法发送给模型");
  }
  const sniffed = sniffProjectAssetImageMime(buffer);
  const mimeType = sniffed || preferredMime || "image/png";
  if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
    throw new Error(`不支持的图片类型：${mimeType}`);
  }
  return {
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    mimeType,
  };
}

async function readLocalAssetAsDataUrl(
  assetId: string,
): Promise<{ dataUrl: string; mimeType: string }> {
  const dir = resolveAppDataPath("assets");
  const entries = await fs.readdir(dir);
  const hit = entries.find((name) => name.startsWith(`${assetId}.`));
  if (!hit) {
    throw new Error(`本地素材文件不存在：${assetId}`);
  }
  const absolute = path.join(dir, hit);
  const buffer = await fs.readFile(absolute);
  const ext = path.extname(hit).toLowerCase();
  const mimeType =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : "image/jpeg";
  return bufferToImageDataUrl(buffer, mimeType);
}

/** 读取项目资产草稿图（含 gen_* 媒体键 / 角色·场景·道具 id）为 data URL */
export async function readProjectDraftImageAsDataUrl(
  projectId: string,
  assetOrMediaId: string,
): Promise<{ dataUrl: string; mimeType: string }> {
  let storageKey = assetOrMediaId;
  if (!assetOrMediaId.startsWith("gen_")) {
    const draft = await loadAssetBundleDraft(projectId);
    const found = draft ? findImageableAssetInDraft(draft, assetOrMediaId) : null;
    if (found) {
      storageKey = resolveAssetImageStorageKey(found.asset);
    }
  }

  if (isRemoteDataOnly()) {
    const remote = await getRemoteAssetImage(projectId, storageKey);
    if (!remote) {
      throw new Error(`项目素材图片不存在：${assetOrMediaId}`);
    }
    return bufferToImageDataUrl(remote.body, remote.contentType);
  }

  const filePath = resolveAssetImageFilePath(projectId, storageKey);
  if (!filePath) {
    throw new Error("不安全的资产图片路径");
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    throw new Error(`项目素材图片不存在：${assetOrMediaId}`);
  }

  const meta = await readProjectAssetImageMeta(projectId, storageKey);
  let preferredMime = meta?.mimeType ?? null;
  try {
    const metaRaw = await fs.readFile(assetImageMetaPath(filePath), "utf-8");
    const parsed = JSON.parse(metaRaw) as { mimeType?: string };
    if (parsed.mimeType) preferredMime = parsed.mimeType;
  } catch {
    /* meta optional */
  }

  return bufferToImageDataUrl(buffer, preferredMime);
}

function parseMaterialMediaUrl(url: string): string | null {
  const pathOnly = (() => {
    try {
      if (/^https?:\/\//i.test(url)) return new URL(url).pathname;
    } catch {
      /* ignore */
    }
    return url.split("?")[0] ?? url;
  })();
  const match = pathOnly.match(/\/api\/materials\/media\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]!) : null;
}

async function readMaterialMediaAsDataUrl(
  mediaId: string,
): Promise<{ dataUrl: string; mimeType: string }> {
  const media = await readMaterialMedia(mediaId);
  if (!media) {
    throw new Error(`素材图片不存在：${mediaId}`);
  }
  return bufferToImageDataUrl(media.body, media.mime);
}

async function resolveImageUrl(
  ref: GenerationAssetReference,
  projectId: string,
): Promise<string> {
  if (isHttpsUrl(ref.sourceUrl) && !isLocalhostUrl(ref.sourceUrl)) {
    return ref.sourceUrl;
  }

  const draftFromUrl = parseProjectDraftImageUrl(ref.sourceUrl);
  if (draftFromUrl) {
    const { dataUrl } = await readProjectDraftImageAsDataUrl(
      draftFromUrl.projectId,
      draftFromUrl.assetOrMediaId,
    );
    return dataUrl;
  }

  const materialMediaId = parseMaterialMediaUrl(ref.sourceUrl);
  if (materialMediaId) {
    const { dataUrl } = await readMaterialMediaAsDataUrl(materialMediaId);
    return dataUrl;
  }

  if (projectId && ref.assetId) {
    try {
      const { dataUrl } = await readProjectDraftImageAsDataUrl(
        projectId,
        ref.assetId,
      );
      return dataUrl;
    } catch {
      /* fall through to legacy /api/assets */
    }
  }

  const fromPath = assetIdFromLocalUrl(ref.sourceUrl) ?? ref.assetId;
  if (!fromPath) {
    throw new Error("当前素材无法被真实模型访问");
  }

  try {
    const { dataUrl } = await readLocalAssetAsDataUrl(fromPath);
    return dataUrl;
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "当前素材无法被真实模型访问",
    );
  }
}

async function resolvePublicOrBlock(
  ref: GenerationAssetReference,
  kindLabel: string,
): Promise<string> {
  if (isHttpsUrl(ref.sourceUrl) && !isLocalhostUrl(ref.sourceUrl)) {
    return ref.sourceUrl;
  }
  throw new Error(
    `当前${kindLabel}仅保存在本机，真实模型无法访问。请先上传到生产对象存储。`,
  );
}

function toMediaType(
  ref: GenerationAssetReference,
): "reference_image" | "reference_video" | "first_frame" {
  if (ref.kind === "first_frame") return "first_frame";
  if (ref.kind === "reference_video") return "reference_video";
  return "reference_image";
}

async function readProjectVoiceAsDataUrl(
  projectId: string,
  voiceAssetId: string,
): Promise<string> {
  if (isRemoteDataOnly()) {
    const draft = await loadAssetBundleDraft(projectId);
    const audio = draft?.audios.find(
      (item) => item.id === voiceAssetId && item.projectId === projectId,
    );
    if (!audio) {
      throw new Error("项目音色文件不存在");
    }
    const metadataMime = normalizeDeclaredAudioMime(audio.mimeType);
    if (!metadataMime) {
      throw new Error("项目音色文件类型不受支持");
    }
    const blob = await getRemoteAssetAudio(projectId, voiceAssetId);
    if (!blob) {
      throw new Error("项目音色文件不存在");
    }
    const blobMime = normalizeDeclaredAudioMime(blob.contentType);
    if (!blobMime || blobMime !== metadataMime) {
      throw new Error("项目音色文件类型不受支持");
    }
    return projectVoiceBufferToDataUrl(blob.body, metadataMime);
  }

  const filePath = resolveAssetAudioFilePath(projectId, voiceAssetId);
  if (!filePath) {
    throw new Error("项目音色路径无效");
  }
  const meta = await readProjectAssetAudioMeta(projectId, voiceAssetId);
  if (!meta?.exists) {
    throw new Error("项目音色文件不存在");
  }
  const buffer = await fs.readFile(filePath);
  return projectVoiceBufferToDataUrl(buffer, meta.mimeType || "audio/mpeg");
}

function projectVoiceBufferToDataUrl(buffer: Buffer, declaredMime: string): string {
  if (buffer.byteLength > MAX_VOICE_BYTES) {
    throw new Error("项目音色文件超过 50MB，无法发送给模型");
  }
  const mimeType = normalizeDeclaredAudioMime(declaredMime);
  if (!mimeType) {
    throw new Error("项目音色文件类型不受支持");
  }
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Resolve a character-bound voice id to a provider-usable URL.
 * Local library + project audio → data URL for real providers; mock uses stream URLs.
 */
export async function resolveBoundVoiceUrl(params: {
  voiceId: string;
  projectId: string;
  forRealProvider: boolean;
}): Promise<string> {
  const { voiceId, projectId, forRealProvider } = params;

  if (isLocalVoiceId(voiceId)) {
    if (!forRealProvider) {
      return getLocalVoiceFileUrl(voiceId);
    }
    const { dataUrl } = await readLocalVoiceAsDataUrl(voiceId);
    return dataUrl;
  }

  if (!forRealProvider) {
    return getProjectAssetAudioUrl(projectId, voiceId);
  }

  return readProjectVoiceAsDataUrl(projectId, voiceId);
}

/**
 * 将最终选定素材解析为 Provider 可用 URL。
 * 顺序：首帧（若有）→ orderedReferenceMedia（用户/自动稳定顺序，不再按类型重排）。
 * 角色参考图若带 referenceVoiceAssetId，会解析并写入 referenceVoiceUrl（角色↔音色绑定）。
 */
export async function resolveProviderAssets(
  input: VideoGenerationInput,
  options?: { forRealProvider: boolean },
): Promise<ResolvedProviderMedia[]> {
  const forReal = options?.forRealProvider ?? true;
  const ordered =
    input.orderedReferenceMedia ??
    [
      ...input.characterReferences,
      ...input.sceneReferences,
      ...input.imageReferences,
      ...input.referenceVideos,
    ];

  const draft = forReal
    ? await loadAssetBundleDraft(input.projectId)
    : null;

  const realPersonCandidateFor = (ref: GenerationAssetReference): boolean => {
    if (!draft) {
      return ref.kind === "character" || ref.kind === "first_frame";
    }
    const asset =
      draft.characters.find((c) => c.id === ref.assetId) ??
      draft.scenes.find((s) => s.id === ref.assetId) ??
      draft.props.find((p) => p.id === ref.assetId);
    const safety = asset?.videoRefSafety;
    // 已走 SD 真人认证通过的素材，在 SD2 视频线路仍须按真人 asset:// 引用
    if (
      safety?.status === "ok" &&
      safety.modelId === "sd2-real-person-cert"
    ) {
      return true;
    }
    if (isLikelyRealPersonForVideoRef(safety)) return true;
    if (safety?.status === "other_risk") return true;
    if (safety?.status === "ok") return false;
    // 未预检/失败：人物与首帧按需认证素材走 SD2 真人线路，避免创建时被拒
    return ref.kind === "character" || ref.kind === "first_frame";
  };

  const result: ResolvedProviderMedia[] = [];

  if (input.firstFrame?.assetId) {
    const url = forReal
      ? await resolveImageUrl(input.firstFrame, input.projectId)
      : input.firstFrame.sourceUrl || `mock://${input.firstFrame.assetId}`;
    result.push({
      type: "first_frame",
      url,
      assetId: input.firstFrame.assetId,
      label: input.firstFrame.label,
      kind: input.firstFrame.kind,
      realPersonCandidate: realPersonCandidateFor(input.firstFrame),
    });
  }

  for (const ref of ordered) {
    if (ref.kind === "reference_video") {
      const url = forReal
        ? await resolvePublicOrBlock(ref, "参考视频")
        : ref.sourceUrl || `mock://${ref.assetId}`;
      result.push({
        type: "reference_video",
        url,
        assetId: ref.assetId,
        label: ref.label,
        kind: ref.kind,
        realPersonCandidate: false,
      });
      continue;
    }

    const url = forReal
      ? await resolveImageUrl(ref, input.projectId)
      : ref.sourceUrl || `mock://${ref.assetId}`;

    let referenceVoiceUrl: string | undefined;
    if (ref.referenceVoiceAssetId) {
      referenceVoiceUrl = await resolveBoundVoiceUrl({
        voiceId: ref.referenceVoiceAssetId,
        projectId: input.projectId,
        forRealProvider: forReal,
      });
    }

    result.push({
      type: toMediaType(ref),
      url,
      assetId: ref.assetId,
      label: ref.label,
      kind: ref.kind,
      realPersonCandidate: realPersonCandidateFor(ref),
      ...(referenceVoiceUrl ? { referenceVoiceUrl } : {}),
    });
  }

  return result;
}

export async function resolveReferenceVoiceUrl(
  sourceUrl: string,
): Promise<string> {
  return resolvePublicOrBlock(
    {
      assetId: "voice",
      kind: "voice",
      label: "音色",
      mimeType: "audio/mpeg",
      sourceUrl,
    },
    "参考音频",
  );
}
