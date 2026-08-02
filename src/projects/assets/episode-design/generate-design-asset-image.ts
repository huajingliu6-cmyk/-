import { createHash, randomUUID } from "crypto";
import { resolveAiCapabilityRuntimeConfig } from "@/ai-config/resolve";
import type { AiCapabilityId } from "@/ai-config/capabilities";
import {
  DEFAULT_IMAGE_PLATFORM_RULE,
  buildAssembledImagePrompt,
} from "@/ai-config/prompt-assembly";
import { generateOpenAiCompatibleImage } from "@/ai-config/openai-compatible-image";
import {
  normalizeDeclaredImageMime,
  sniffProjectAssetImageMime,
  writeProjectAssetImageFile,
  type ProjectAssetImageMime,
} from "@/projects/assets/asset-image-storage";
import type { EpisodeAssetDesignAssetType } from "@/projects/assets/episode-design/types";

/** Fixed output contract for design 「生成资产」文生图 */
export const DESIGN_ASSET_IMAGE_ASPECT_RATIO = "16:9";
export const DESIGN_ASSET_IMAGE_RESOLUTION = "4K";

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
): string {
  return DEFAULT_IMAGE_PLATFORM_RULE;
}

/**
 * @deprecated Prefer buildAssembledImagePrompt — kept for tests/compat as platform brief only.
 * Does NOT append conflicting cinematic / anti-turnaround style clauses.
 */
export function enrichDesignAssetImagePrompt(
  prompt: string,
  assetType: EpisodeAssetDesignAssetType,
): string {
  const base = prompt.trim();
  const composition = designAssetPlatformRule(assetType);
  if (base.includes("16:9") && base.includes("4K")) {
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
  mode: "mock" | "http";
  notice: string;
  finalPrompt: string;
  promptFingerprint: string;
  aspectRatio: typeof DESIGN_ASSET_IMAGE_ASPECT_RATIO;
  resolution: typeof DESIGN_ASSET_IMAGE_RESOLUTION;
};

/**
 * Text-to-image for episode asset design items.
 * Always 16:9 + 4K API contract; prompt includes admin published task rules.
 */
export async function generateDesignAssetImage(input: {
  projectId: string;
  assetType: EpisodeAssetDesignAssetType;
  assetName: string;
  prompt: string;
}): Promise<DesignAssetImageGenerationResult> {
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
    platformRule: designAssetPlatformRule(input.assetType),
  });
  const finalPrompt = assembled.finalPrompt;
  const fp = promptFingerprint(finalPrompt);
  const mediaId = newDesignMediaId();

  const resolved = await resolveAiCapabilityRuntimeConfig(capabilityId);
  const config = resolved.profile;
  const endpoint = config.apiUrl.trim();

  let buffer: Buffer;
  let mimeDeclared: string;
  let mode: "mock" | "http";
  let notice: string;

  if (config.provider === "http") {
    if (!endpoint) {
      throw new Error(
        "未配置文生图 API 地址，请管理员在「管理 API」中接入对应图片模型",
      );
    }
    const generated = await generateOpenAiCompatibleImage({
      endpoint,
      apiKey: config.apiKey,
      prompt: finalPrompt,
      model: config.model || undefined,
      aspectRatio: DESIGN_ASSET_IMAGE_ASPECT_RATIO,
      resolution: DESIGN_ASSET_IMAGE_RESOLUTION,
      extra: {
        characterName: input.assetName,
        kind: input.assetType,
      },
    });
    buffer = generated.buffer;
    mimeDeclared = generated.mimeType;
    mode = "http";
    notice = "已生成 4K · 16:9 参考图";
  } else {
    buffer = MOCK_PNG;
    mimeDeclared = "image/png";
    mode = "mock";
    notice =
      "当前为本地演示图（未连接真实文生图）。管理员可在「管理 API」接入角色/场景/道具图片模型。";
  }

  const mimeType = resolveMime(buffer, mimeDeclared);
  await writeProjectAssetImageFile({
    projectId: input.projectId,
    assetId: mediaId,
    buffer,
    mimeType,
  });

  return {
    mediaId,
    mimeType,
    mode,
    notice,
    finalPrompt,
    promptFingerprint: fp,
    aspectRatio: DESIGN_ASSET_IMAGE_ASPECT_RATIO,
    resolution: DESIGN_ASSET_IMAGE_RESOLUTION,
  };
}
