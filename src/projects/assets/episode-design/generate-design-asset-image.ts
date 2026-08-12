import { createHash, randomUUID } from "crypto";
import { resolveAiCapabilityRuntimeConfig } from "@/ai-config/resolve";
import type { AiCapabilityId } from "@/ai-config/capabilities";
import { buildAssembledImagePrompt } from "@/ai-config/prompt-assembly";
import { generateOpenAiCompatibleImages } from "@/ai-config/openai-compatible-image";
import {
  normalizeDeclaredImageMime,
  sniffProjectAssetImageMime,
  writeProjectAssetImageFile,
  deleteProjectAssetImageFile,
  type ProjectAssetImageMime,
} from "@/projects/assets/asset-image-storage";
import type { EpisodeAssetDesignAssetType } from "@/projects/assets/episode-design/types";
import {
  DEFAULT_DESIGN_IMAGE_OPTIONS,
  DESIGN_IMAGE_QUALITY_LABELS,
  designImageQualityToResolution,
  type DesignImageAspectRatio,
  type DesignImageCount,
  type DesignImageQuality,
} from "@/projects/assets/episode-design/image-generation-options";

/** @deprecated Prefer DEFAULT_DESIGN_IMAGE_OPTIONS.aspectRatio */
export const DESIGN_ASSET_IMAGE_ASPECT_RATIO =
  DEFAULT_DESIGN_IMAGE_OPTIONS.aspectRatio;
/** @deprecated Prefer quality→resolution mapping */
export const DESIGN_ASSET_IMAGE_RESOLUTION = "4K" as const;

const MOCK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export function capabilityForDesignAssetType(
  assetType: EpisodeAssetDesignAssetType,
): AiCapabilityId | null {
  switch (assetType) {
    case "character":
      return "image.character.generate";
    case "scene":
      return "image.scene.generate";
    case "prop":
      return "image.prop.generate";
    case "audio":
      return null;
  }
}

/**
 * Platform-only output brief (画幅/分辨率).
 * Style / composition come from admin published task rules via buildAssembledImagePrompt.
 */
export function designAssetPlatformRule(
  _assetType: EpisodeAssetDesignAssetType,
  aspectRatio: DesignImageAspectRatio = DEFAULT_DESIGN_IMAGE_OPTIONS.aspectRatio,
  quality: DesignImageQuality = DEFAULT_DESIGN_IMAGE_OPTIONS.quality,
): string {
  const resolution = designImageQualityToResolution(quality);
  return `输出规格：${aspectRatio}构图、${resolution}分辨率。勿添加文字水印、界面 UI 或字幕条。若管理员任务规则与画幅/分辨率冲突，以本规格为准。`;
}

/**
 * @deprecated Prefer buildAssembledImagePrompt — kept for tests/compat as platform brief only.
 * Does NOT append conflicting cinematic / anti-turnaround style clauses.
 */
export function enrichDesignAssetImagePrompt(
  prompt: string,
  assetType: EpisodeAssetDesignAssetType,
  aspectRatio: DesignImageAspectRatio = DEFAULT_DESIGN_IMAGE_OPTIONS.aspectRatio,
  quality: DesignImageQuality = DEFAULT_DESIGN_IMAGE_OPTIONS.quality,
): string {
  const base = prompt.trim();
  const composition = designAssetPlatformRule(assetType, aspectRatio, quality);
  const resolution = designImageQualityToResolution(quality);
  if (base.includes(aspectRatio) && base.includes(resolution)) {
    return base;
  }
  return `${base}\n\n${composition}`;
}

export function promptFingerprint(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex").slice(0, 32);
}

export function newDesignMediaId(): string {
  return `gen_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function resolveMime(buffer: Buffer, declared: string): ProjectAssetImageMime {
  const sniffed = sniffProjectAssetImageMime(buffer);
  if (sniffed) return sniffed;
  const normalized = normalizeDeclaredImageMime(declared);
  if (normalized) return normalized;
  return "image/png";
}

export type DesignAssetImageGenerationResult = {
  mediaId: string;
  mimeType: ProjectAssetImageMime;
  images: Array<{
    mediaId: string;
    mimeType: ProjectAssetImageMime;
  }>;
  mode: "mock" | "http";
  notice: string;
  finalPrompt: string;
  promptFingerprint: string;
  quality: DesignImageQuality;
  aspectRatio: DesignImageAspectRatio;
  count: number;
  /** @deprecated Prefer quality */
  resolution: "4K" | "2K" | "1K";
};

/**
 * Text-to-image for episode asset design items.
 * Defaults: high / 16:9 / 1 — keeps legacy callers compatible.
 */
export async function generateDesignAssetImage(input: {
  projectId: string;
  assetType: EpisodeAssetDesignAssetType;
  assetName: string;
  prompt: string;
  quality?: DesignImageQuality;
  aspectRatio?: DesignImageAspectRatio;
  count?: DesignImageCount;
}): Promise<DesignAssetImageGenerationResult> {
  const quality = input.quality ?? DEFAULT_DESIGN_IMAGE_OPTIONS.quality;
  const aspectRatio =
    input.aspectRatio ?? DEFAULT_DESIGN_IMAGE_OPTIONS.aspectRatio;
  const requestedCount = input.count ?? DEFAULT_DESIGN_IMAGE_OPTIONS.count;
  const resolution = designImageQualityToResolution(quality);

  const capabilityId = capabilityForDesignAssetType(input.assetType);
  if (!capabilityId) {
    throw Object.assign(new Error("当前未配置该类型的音频生成能力"), {
      code: "AUDIO_GENERATION_UNAVAILABLE",
      status: 403,
    });
  }

  const assembled = await buildAssembledImagePrompt({
    capabilityId,
    userPrompt: input.prompt,
    platformRule: designAssetPlatformRule(
      input.assetType,
      aspectRatio,
      quality,
    ),
  });
  const finalPrompt = assembled.finalPrompt;
  const fp = promptFingerprint(finalPrompt);

  const resolved = await resolveAiCapabilityRuntimeConfig(capabilityId);
  const config = resolved.profile;
  const endpoint = config.apiUrl.trim();

  let mode: "mock" | "http";
  let notice: string;
  let rawImages: Array<{ buffer: Buffer; mimeType: string }>;

  if (config.provider === "http") {
    if (!endpoint) {
      throw new Error(
        "未配置文生图 API 地址，请管理员在「管理 API」中接入对应图片模型",
      );
    }
    const generated = await generateOpenAiCompatibleImages({
      endpoint,
      apiKey: config.apiKey,
      prompt: finalPrompt,
      model: config.model || undefined,
      aspectRatio,
      resolution,
      quality,
      count: requestedCount,
      extra: {
        characterName: input.assetName,
        kind: input.assetType,
      },
    });
    rawImages = generated.images.slice(0, 4);
    mode = "http";
    notice = `已生成 ${rawImages.length} 张 · ${DESIGN_IMAGE_QUALITY_LABELS[quality]} · ${aspectRatio}`;
  } else {
    rawImages = Array.from({ length: requestedCount }, () => ({
      buffer: MOCK_PNG,
      mimeType: "image/png",
    }));
    mode = "mock";
    notice =
      "当前为本地演示图（未连接真实文生图）。管理员可在「管理 API」接入角色/场景/道具图片模型。";
  }

  if (rawImages.length === 0) {
    throw new Error("文生图服务未返回图片");
  }

  const written: Array<{ mediaId: string; mimeType: ProjectAssetImageMime }> =
    [];

  try {
    for (const image of rawImages) {
      const mediaId = newDesignMediaId();
      const mimeType = resolveMime(image.buffer, image.mimeType);
      await writeProjectAssetImageFile({
        projectId: input.projectId,
        assetId: mediaId,
        buffer: image.buffer,
        mimeType,
      });
      written.push({ mediaId, mimeType });
    }
  } catch (error) {
    await Promise.all(
      written.map((entry) =>
        deleteProjectAssetImageFile(input.projectId, entry.mediaId).catch(
          () => undefined,
        ),
      ),
    );
    throw error;
  }

  const first = written[0]!;
  return {
    mediaId: first.mediaId,
    mimeType: first.mimeType,
    images: written,
    mode,
    notice,
    finalPrompt,
    promptFingerprint: fp,
    quality,
    aspectRatio,
    count: written.length,
    resolution,
  };
}
