import "server-only";

import { randomUUID } from "crypto";
import { resolveAiCapabilityRuntimeConfig } from "@/ai-config/resolve";
import {
  editOpenAiCompatibleImages,
  generateOpenAiCompatibleImages,
  normalizeImageAspectRatio,
} from "@/ai-config/openai-compatible-image";
import { saveMaterialMedia } from "@/materials/media-store";
import { readFormDataImageFile } from "@/personal/form-data-image";
import {
  PERSONAL_IMAGE_MAX_REFERENCES,
  personalImageMediaUrl,
  personalResolutionToQuality,
} from "@/personal/image-generation/constants";
import {
  newPersonalImageHistoryId,
  prependPersonalImageHistory,
} from "@/personal/image-generation/store";
import type {
  PersonalImageCount,
  PersonalImageHistoryItem,
  PersonalImageResolution,
} from "@/personal/image-generation/types";
import {
  isDesignImageModelId,
  type DesignImageModelId,
} from "@/projects/assets/episode-design/image-generation-models";
import type { ProjectAssetImageMime } from "@/projects/assets/asset-image-storage";

const MOCK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const PERSONAL_IMAGE_CAPABILITY = "image.character.generate" as const;

function parseCount(raw: FormDataEntryValue | null): PersonalImageCount {
  const value = Number(String(raw ?? "1"));
  if (value === 2) return 2;
  if (value === 3) return 3;
  return 1;
}

function parseResolution(
  raw: FormDataEntryValue | null,
): PersonalImageResolution {
  const value = String(raw ?? "1K");
  if (value === "2K") return "2K";
  if (value === "4K") return "4K";
  return "1K";
}

function parseModel(raw: FormDataEntryValue | null): DesignImageModelId {
  const value = String(raw ?? "gpt-image-2");
  return isDesignImageModelId(value) ? value : "gpt-image-2";
}

function mimeFromBuffer(buffer: Buffer, declared?: string): ProjectAssetImageMime {
  if (declared === "image/jpeg" || declared === "image/png" || declared === "image/webp") {
    return declared;
  }
  return "image/png";
}

export async function generatePersonalImages(input: {
  userId: string;
  form: FormData;
}): Promise<PersonalImageHistoryItem[]> {
  const prompt = String(input.form.get("prompt") ?? "").trim();
  if (!prompt) {
    throw Object.assign(new Error("请输入提示词"), {
      code: "PROMPT_REQUIRED",
      status: 400,
    });
  }

  const aspectRatio = normalizeImageAspectRatio(
    String(input.form.get("aspectRatio") ?? "16:9"),
  );
  const resolution = parseResolution(input.form.get("resolution"));
  const modelId = parseModel(input.form.get("model"));
  const count = parseCount(input.form.get("count"));
  const quality = personalResolutionToQuality(resolution);

  const referenceImages: Array<{
    buffer: Buffer;
    mimeType: ProjectAssetImageMime;
    fileName: string;
  }> = [];

  const referenceEntries = [
    ...input.form.getAll("image"),
    ...input.form.getAll("images"),
  ];
  for (const entry of referenceEntries) {
    if (referenceImages.length >= PERSONAL_IMAGE_MAX_REFERENCES) break;
    const parsed = await readFormDataImageFile(entry);
    if (!parsed) continue;
    referenceImages.push({
      buffer: parsed.buffer,
      mimeType: parsed.mime,
      fileName: parsed.fileName,
    });
  }

  const resolved = await resolveAiCapabilityRuntimeConfig(PERSONAL_IMAGE_CAPABILITY);
  const config = resolved.profile;
  const endpoint = config.apiUrl.trim();
  const effectiveModel = modelId || config.model;

  let rawImages: Array<{ buffer: Buffer; mimeType: string }>;

  if (config.provider === "http") {
    if (!endpoint) {
      throw new Error(
        "未配置文生图 API 地址，请管理员在「系统管理 → API 接口」中接入图片模型",
      );
    }
    const generated =
      referenceImages.length > 0
        ? await editOpenAiCompatibleImages({
            endpoint,
            apiKey: config.apiKey,
            prompt,
            model: effectiveModel || undefined,
            aspectRatio,
            resolution,
            quality,
            count,
            images: referenceImages,
            extra: { scope: "personal-image" },
          })
        : await generateOpenAiCompatibleImages({
            endpoint,
            apiKey: config.apiKey,
            prompt,
            model: effectiveModel || undefined,
            aspectRatio,
            resolution,
            quality,
            count,
            extra: { scope: "personal-image" },
          });
    rawImages = generated.images.slice(0, count);
  } else {
    rawImages = Array.from({ length: count }, () => ({
      buffer: MOCK_PNG,
      mimeType: "image/png",
    }));
  }

  if (rawImages.length === 0) {
    throw new Error(
      referenceImages.length > 0 ? "图生图服务未返回图片" : "文生图服务未返回图片",
    );
  }

  const generatedAt = new Date().toISOString();
  const created: PersonalImageHistoryItem[] = [];

  for (const image of rawImages) {
    const saved = await saveMaterialMedia({
      buffer: image.buffer,
      declaredMime: image.mimeType,
    });
    created.push({
      id: newPersonalImageHistoryId(),
      imageUrl: personalImageMediaUrl(saved.mediaId),
      name: defaultPersonalMaterialName(prompt),
      prompt,
      aspectRatio,
      resolution,
      modelId,
      count,
      generatedAt,
      uploadedToPersonalAssets: false,
    });
  }

  await prependPersonalImageHistory(input.userId, created);
  return created;
}

export function extractMediaIdFromImageUrl(imageUrl: string): string | null {
  const match = imageUrl.match(/\/api\/materials\/media\/([^/?#]+)/i);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function defaultPersonalMaterialName(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return `生图 ${randomUUID().slice(0, 8)}`;
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}
