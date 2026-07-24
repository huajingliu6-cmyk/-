import type {
  ModelCapability,
  ProviderGenerationInput,
  ResolvedProviderMedia,
  VideoAspectRatio,
  VideoGenerationInput,
} from "./types";

export type Wan27RequestBody = {
  model: string;
  input: {
    prompt: string;
    negative_prompt?: string;
    media?: Array<{
      type: "reference_image" | "reference_video" | "first_frame";
      url: string;
      reference_voice?: string;
    }>;
  };
  parameters: {
    resolution: string;
    duration: number;
    prompt_extend: boolean;
    watermark: boolean;
    seed?: number;
    ratio?: VideoAspectRatio;
  };
};

function directorPrompt(input: VideoGenerationInput): string {
  const d = input.directorSettings;
  if (!d) return "";
  const parts: string[] = [];
  if (d.actionDescription) parts.push(`动作：${d.actionDescription}`);
  if (d.shotSize) parts.push(`景别：${d.shotSize}`);
  if (d.cameraAngle) parts.push(`机位：${d.cameraAngle}`);
  if (d.cameraMovement) parts.push(`运镜：${d.cameraMovement}`);
  if (d.focalLength) parts.push(`焦距：${d.focalLength}`);
  if (d.colorTone) parts.push(`色调：${d.colorTone}`);
  if (d.stylePreset) parts.push(`风格：${d.stylePreset}`);
  return parts.join("；");
}

/**
 * 保持 resolveProviderAssets 给出的顺序：
 * first_frame（若有且已在列表前端）之后的普通参考素材不再按 image/video 重分组。
 * 若 first_frame 不在首位，则提到最前，其余相对顺序不变。
 */
export function orderResolvedMedia(
  resolved: ResolvedProviderMedia[],
): ResolvedProviderMedia[] {
  const first = resolved.filter((m) => m.type === "first_frame");
  const rest = resolved.filter((m) => m.type !== "first_frame");
  return [...first, ...rest];
}

export function buildPromptWithMediaRefs(
  input: VideoGenerationInput,
  media: ResolvedProviderMedia[],
): string {
  const images = media.filter((m) => m.type === "reference_image");
  const videos = media.filter((m) => m.type === "reference_video");

  const refLines: string[] = [];
  images.forEach((m, i) => {
    refLines.push(`图${i + 1}（${m.label}）`);
  });
  videos.forEach((m, i) => {
    refLines.push(`视频${i + 1}（${m.label}）`);
  });

  const chunks: string[] = [];
  if (refLines.length > 0) {
    chunks.push(`参考素材：${refLines.join("、")}。`);
  }
  if (input.textInputs.length > 0) {
    chunks.push(input.textInputs.join("\n"));
  }
  const director = directorPrompt(input);
  if (director) chunks.push(director);
  chunks.push(input.prompt.trim());
  return chunks.filter(Boolean).join("\n");
}

export function buildWan27Request(
  input: VideoGenerationInput,
  capability: ModelCapability,
  resolvedMedia: ResolvedProviderMedia[],
): Wan27RequestBody {
  const media = orderResolvedMedia(resolvedMedia);
  const prompt = buildPromptWithMediaRefs(input, media);

  const parameters: Wan27RequestBody["parameters"] = {
    resolution: input.resolution,
    duration: input.durationSeconds,
    prompt_extend: input.promptExtend,
    watermark: input.watermark,
  };

  if (typeof input.seed === "number") {
    parameters.seed = input.seed;
  }

  const hasFirstFrame = media.some((m) => m.type === "first_frame");
  if (!hasFirstFrame && input.aspectRatio) {
    parameters.ratio = input.aspectRatio;
  }

  const body: Wan27RequestBody = {
    model: capability.modelId,
    input: {
      prompt,
    },
    parameters,
  };

  if (input.negativePrompt?.trim()) {
    body.input.negative_prompt = input.negativePrompt.trim();
  }

  if (capability.mode === "referenceToVideo") {
    body.input.media = media.map((m) => {
      const item: {
        type: "reference_image" | "reference_video" | "first_frame";
        url: string;
        reference_voice?: string;
      } = { type: m.type, url: m.url };
      if (m.referenceVoiceUrl) {
        item.reference_voice = m.referenceVoiceUrl;
      }
      return item;
    });
  }

  return body;
}

/** 去敏摘要：不包含 base64 / Authorization */
export function summarizeWan27Request(body: Wan27RequestBody): Record<string, unknown> {
  return {
    model: body.model,
    promptLength: body.input.prompt.length,
    hasNegativePrompt: Boolean(body.input.negative_prompt),
    media: (body.input.media ?? []).map((m) => ({
      type: m.type,
      urlKind: m.url.startsWith("data:")
        ? "data-url"
        : m.url.startsWith("https://")
          ? "https"
          : "other",
      hasReferenceVoice: Boolean(m.reference_voice),
    })),
    parameters: {
      resolution: body.parameters.resolution,
      ratio: body.parameters.ratio ?? null,
      duration: body.parameters.duration,
      watermark: body.parameters.watermark,
      prompt_extend: body.parameters.prompt_extend,
      hasSeed: typeof body.parameters.seed === "number",
    },
  };
}

export function buildWan27RequestFromProviderInput(
  providerInput: ProviderGenerationInput,
): Wan27RequestBody {
  return buildWan27Request(
    providerInput.input,
    providerInput.capability,
    providerInput.resolvedMedia,
  );
}
