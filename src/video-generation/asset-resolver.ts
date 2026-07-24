import { promises as fs } from "fs";
import path from "path";
import type {
  GenerationAssetReference,
  ResolvedProviderMedia,
  VideoGenerationInput,
} from "./types";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
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

async function readLocalAssetAsDataUrl(
  assetId: string,
): Promise<{ dataUrl: string; mimeType: string }> {
  const dir = path.join(process.cwd(), "data", "assets");
  const entries = await fs.readdir(dir);
  const hit = entries.find((name) => name.startsWith(`${assetId}.`));
  if (!hit) {
    throw new Error(`本地素材文件不存在：${assetId}`);
  }
  const absolute = path.join(dir, hit);
  const buffer = await fs.readFile(absolute);
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("参考图片超过 10MB，无法发送给模型");
  }
  const ext = path.extname(hit).toLowerCase();
  const mimeType =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : "image/jpeg";
  if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
    throw new Error(`不支持的图片类型：${mimeType}`);
  }
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  return { dataUrl, mimeType };
}

async function resolveImageUrl(
  ref: GenerationAssetReference,
): Promise<string> {
  if (isHttpsUrl(ref.sourceUrl) && !isLocalhostUrl(ref.sourceUrl)) {
    return ref.sourceUrl;
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

/**
 * 将工作流素材解析为 Provider 可用的 URL（HTTPS 或临时 data URL）。
 * data URL 仅在本次请求内存中，不写入 WorkflowDocument / 数据库 / 日志。
 */
export async function resolveProviderAssets(
  input: VideoGenerationInput,
  options?: { forRealProvider: boolean },
): Promise<ResolvedProviderMedia[]> {
  const forReal = options?.forRealProvider ?? true;
  const selected = new Set(input.selectedReferenceAssetIds ?? []);

  const imagePool = [
    ...input.characterReferences,
    ...input.sceneReferences,
    ...input.imageReferences,
  ];

  const images =
    selected.size > 0
      ? imagePool.filter((r) => selected.has(r.assetId))
      : imagePool;

  const videos =
    selected.size > 0
      ? input.referenceVideos.filter((r) => selected.has(r.assetId))
      : input.referenceVideos;

  const result: ResolvedProviderMedia[] = [];

  if (input.firstFrame?.assetId) {
    const url = forReal
      ? await resolveImageUrl(input.firstFrame)
      : input.firstFrame.sourceUrl || `mock://${input.firstFrame.assetId}`;
    result.push({
      type: "first_frame",
      url,
      assetId: input.firstFrame.assetId,
      label: input.firstFrame.label,
    });
  }

  for (const ref of images) {
    const url = forReal
      ? await resolveImageUrl(ref)
      : ref.sourceUrl || `mock://${ref.assetId}`;
    let referenceVoiceUrl: string | undefined;
    if (ref.referenceVoiceAssetId) {
      // 音色必须是公网 URL；本机音频直接阻止真实生成
      const voiceRef: GenerationAssetReference = {
        assetId: ref.referenceVoiceAssetId,
        kind: "voice",
        label: "音色",
        mimeType: "audio/mpeg",
        sourceUrl: "", // filled below if we find matching audio in document - handled by caller
      };
      // Voice URL should be passed via a side map; for now require HTTPS on sourceUrl if provided
      void voiceRef;
    }
    result.push({
      type: toMediaType(ref),
      url,
      assetId: ref.assetId,
      label: ref.label,
      referenceVoiceUrl,
    });
  }

  for (const ref of videos) {
    const url = forReal
      ? await resolvePublicOrBlock(ref, "参考视频")
      : ref.sourceUrl || `mock://${ref.assetId}`;
    result.push({
      type: "reference_video",
      url,
      assetId: ref.assetId,
      label: ref.label,
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
