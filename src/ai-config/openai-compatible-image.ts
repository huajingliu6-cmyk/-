/**
 * OpenAI-compatible image generation helpers (images/generations).
 * Used by canvas character/scene gen and episode asset design 「生成资产」.
 */

export type OpenAiCompatibleImageRequest = {
  endpoint: string;
  apiKey: string;
  prompt: string;
  model?: string;
  /** Logical aspect; mapped to provider size string */
  aspectRatio?: string;
  /** Logical resolution hint: 1K / 2K / 4K */
  resolution?: string;
  /** Provider quality: high | medium | low */
  quality?: "high" | "medium" | "low";
  /** Number of images to request (1–4) */
  count?: number;
  /** Extra metadata fields some proxies accept */
  extra?: Record<string, unknown>;
};

export type OpenAiCompatibleImageResult = {
  buffer: Buffer;
  mimeType: string;
  resolvedUrl: string;
};

export type OpenAiCompatibleImagesResult = {
  images: Array<{ buffer: Buffer; mimeType: string }>;
  resolvedUrl: string;
};

const SUPPORTED_ASPECT_RATIOS = new Set([
  "1:1",
  "5:4",
  "9:16",
  "21:9",
  "16:9",
  "4:3",
  "3:2",
  "4:5",
  "3:4",
  "2:3",
]);

/**
 * Admin often saves base URLs like `https://host/v1`.
 * Append `/images/generations` unless the path already looks like an image route.
 */
export function resolveOpenAiCompatibleImageEndpoint(apiUrl: string): string {
  const trimmed = apiUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("未配置文生图 API 地址");
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("/images/generations") ||
    lower.includes("/text2image/") ||
    lower.includes("/image-generation/") ||
    lower.includes("/image-synthesis") ||
    lower.includes("/images/edits")
  ) {
    return trimmed;
  }
  return `${trimmed}/images/generations`;
}

export function normalizeImageAspectRatio(aspectRatio?: string): string {
  const raw = (aspectRatio ?? "16:9").trim().replace("/", ":");
  if (SUPPORTED_ASPECT_RATIOS.has(raw)) return raw;
  return "16:9";
}

/** Normalize to API tier: 1k | 2k | 4k */
export function normalizeImageResolutionTier(
  resolution?: string,
): "1k" | "2k" | "4k" {
  const raw = (resolution ?? "4K").trim().toUpperCase();
  if (raw === "1K" || raw.includes("1080") || raw.includes("1024")) return "1k";
  if (
    raw === "2K" ||
    raw.includes("1440") ||
    raw.includes("2560") ||
    raw.includes("2048")
  ) {
    return "2k";
  }
  return "4k";
}

function nearestEven(value: number): number {
  const rounded = Math.round(value);
  if (rounded % 2 === 0) return Math.max(2, rounded);
  const down = rounded - 1;
  const up = rounded + 1;
  return Math.abs(value - down) <= Math.abs(value - up)
    ? Math.max(2, down)
    : up;
}

/**
 * Pixel size for providers that want WIDTHxHEIGHT.
 * Long-edge: 4K=3840, 2K=2560, 1K=1920. Square keeps legacy sizes.
 */
export function mapImageSize(params: {
  aspectRatio?: string;
  resolution?: string;
}): string {
  const aspect = normalizeImageAspectRatio(params.aspectRatio);
  const tier = normalizeImageResolutionTier(params.resolution);

  if (aspect === "1:1") {
    if (tier === "4k") return "2160x2160";
    if (tier === "2k") return "2048x2048";
    return "1024x1024";
  }

  const [wRatioRaw, hRatioRaw] = aspect.split(":");
  const wRatio = Number(wRatioRaw);
  const hRatio = Number(hRatioRaw);
  if (!Number.isFinite(wRatio) || !Number.isFinite(hRatio) || wRatio <= 0 || hRatio <= 0) {
    return tier === "4k" ? "3840x2160" : tier === "2k" ? "2560x1440" : "1920x1080";
  }

  const longEdge = tier === "4k" ? 3840 : tier === "2k" ? 2560 : 1920;
  if (wRatio >= hRatio) {
    const width = longEdge;
    const height = nearestEven(longEdge * (hRatio / wRatio));
    return `${width}x${height}`;
  }
  const height = longEdge;
  const width = nearestEven(longEdge * (wRatio / hRatio));
  return `${width}x${height}`;
}

function clampImageCount(count?: number): number {
  if (typeof count !== "number" || !Number.isFinite(count)) return 1;
  return Math.min(4, Math.max(1, Math.floor(count)));
}

function normalizeQuality(
  quality?: string,
): "high" | "medium" | "low" {
  if (quality === "medium" || quality === "low" || quality === "high") {
    return quality;
  }
  return "high";
}

type ExtractedImage = {
  base64?: string;
  url?: string;
  mimeType?: string;
};

function extractAllImagePayloads(
  json: Record<string, unknown>,
): ExtractedImage[] {
  const out: ExtractedImage[] = [];

  if (typeof json.base64 === "string" && json.base64.trim()) {
    out.push({
      base64: json.base64,
      mimeType: typeof json.mimeType === "string" ? json.mimeType : undefined,
    });
  }
  if (typeof json.url === "string" && json.url.trim()) {
    out.push({ url: json.url });
  }

  const data = json.data;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      if (typeof row.b64_json === "string" && row.b64_json.trim()) {
        out.push({ base64: row.b64_json, mimeType: "image/png" });
        continue;
      }
      if (typeof row.url === "string" && row.url.trim()) {
        out.push({ url: row.url });
        continue;
      }
      if (typeof row.base64 === "string" && row.base64.trim()) {
        out.push({
          base64: row.base64,
          mimeType:
            typeof row.mimeType === "string" ? row.mimeType : "image/png",
        });
      }
    }
  }

  const output = json.output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const outObj = output as Record<string, unknown>;
    const results = outObj.results;
    if (Array.isArray(results)) {
      for (const item of results) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        if (typeof row.url === "string" && row.url.trim()) {
          out.push({ url: row.url });
        } else if (typeof row.b64_json === "string" && row.b64_json.trim()) {
          out.push({ base64: row.b64_json, mimeType: "image/png" });
        }
      }
    }
  }

  return out.slice(0, 4);
}

async function materializeExtractedImage(
  extracted: ExtractedImage,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (extracted.base64) {
    return {
      buffer: Buffer.from(extracted.base64, "base64"),
      mimeType: extracted.mimeType || "image/png",
    };
  }
  if (extracted.url) {
    const fileRes = await fetch(extracted.url);
    if (!fileRes.ok) {
      throw new Error("无法下载文生图返回的图片 URL");
    }
    return {
      buffer: Buffer.from(await fileRes.arrayBuffer()),
      mimeType: fileRes.headers.get("content-type") || "image/png",
    };
  }
  throw new Error("文生图服务响应缺少图片数据");
}

async function parseImagesSuccessResponse(
  res: Response,
  resolvedUrl: string,
): Promise<OpenAiCompatibleImagesResult> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {
      images: [
        {
          buffer: Buffer.from(await res.arrayBuffer()),
          mimeType: contentType || "image/png",
        },
      ],
      resolvedUrl,
    };
  }

  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.error === "string" && json.error.trim()) {
    throw new Error(json.error);
  }
  if (
    json.error &&
    typeof json.error === "object" &&
    !Array.isArray(json.error)
  ) {
    const errObj = json.error as Record<string, unknown>;
    const msg =
      typeof errObj.message === "string"
        ? errObj.message
        : JSON.stringify(json.error).slice(0, 200);
    throw new Error(msg);
  }

  const extracted = extractAllImagePayloads(json);
  if (extracted.length === 0) {
    throw new Error(
      "文生图服务响应缺少图片数据（期望 data[].b64_json / data[].url）",
    );
  }

  const images = await Promise.all(
    extracted.map((item) => materializeExtractedImage(item)),
  );

  return { images, resolvedUrl };
}

function buildImageRequestBody(input: {
  prompt: string;
  model?: string;
  aspect: string;
  tier: "1k" | "2k" | "4k";
  quality: "high" | "medium" | "low";
  count: number;
  pixelSize: string;
  sizeMode: "aspect" | "pixel";
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const size = input.sizeMode === "pixel" ? input.pixelSize : input.aspect;
  return {
    prompt: input.prompt,
    n: input.count,
    ...(input.model ? { model: input.model } : {}),
    quality: input.quality,
    size,
    resolution: input.tier,
    aspect_ratio: input.aspect,
    output_size: input.pixelSize,
    width: Number(input.pixelSize.split("x")[0]),
    height: Number(input.pixelSize.split("x")[1]),
    upscale: input.tier === "4k" ? "4K" : input.tier.toUpperCase(),
    ...(input.extra ?? {}),
  };
}

/**
 * Batch OpenAI-compatible `/images/generations`.
 * Sends n/size/quality and materializes every returned image (max 4).
 */
export async function generateOpenAiCompatibleImages(
  params: OpenAiCompatibleImageRequest,
): Promise<OpenAiCompatibleImagesResult> {
  const resolvedUrl = resolveOpenAiCompatibleImageEndpoint(params.endpoint);
  const aspect = normalizeImageAspectRatio(params.aspectRatio);
  const tier = normalizeImageResolutionTier(params.resolution);
  const quality = normalizeQuality(params.quality);
  const count = clampImageCount(params.count);
  const pixelSize = mapImageSize({
    aspectRatio: aspect,
    resolution: tier.toUpperCase(),
  });

  const body = buildImageRequestBody({
    prompt: params.prompt,
    model: params.model,
    aspect,
    tier,
    quality,
    count,
    pixelSize,
    sizeMode: "aspect",
    extra: params.extra,
  });

  const res = await fetch(resolvedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = text.slice(0, 240) || res.statusText;
    try {
      const parsed = JSON.parse(text) as {
        error?: { code?: string; message?: string };
      };
      const code = parsed.error?.code ?? "";
      const message = parsed.error?.message ?? "";
      if (code === "model_not_allowed" || /无权调用模型/.test(message)) {
        throw new Error(
          `${message || "当前 API Key 无权调用该图片模型"}。请到「系统管理 → API 接口」→「角色外貌生成」更换有权限的模型名，或更换可用的 API Key。`,
        );
      }
      if (
        res.status === 400 &&
        (/size|resolution|unmarshal|invalid/i.test(message) ||
          /size|resolution|unmarshal|invalid/i.test(detail))
      ) {
        const retryBody = buildImageRequestBody({
          prompt: params.prompt,
          model: params.model,
          aspect,
          tier,
          quality,
          count,
          pixelSize,
          sizeMode: "pixel",
          extra: params.extra,
        });
        const retry = await fetch(resolvedUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(params.apiKey
              ? { Authorization: `Bearer ${params.apiKey}` }
              : {}),
          },
          body: JSON.stringify(retryBody),
        });
        if (retry.ok) {
          return parseImagesSuccessResponse(retry, resolvedUrl);
        }
        const retryText = await retry.text();
        detail = `${message || detail}；像素尺寸重试亦失败：${retryText.slice(0, 160)}`;
      } else if (message) {
        detail = message;
      }
    } catch (e) {
      if (e instanceof Error && (e.message.includes("系统管理") || e.message.includes("管理 API"))) throw e;
    }
    throw new Error(
      `文生图服务返回错误（${res.status}）：${detail}（请求 ${resolvedUrl}）`,
    );
  }

  return parseImagesSuccessResponse(res, resolvedUrl);
}

/**
 * POST OpenAI-compatible `/images/generations` (or already-absolute image route).
 * Single-image wrapper — keeps canvas / legacy callers compatible.
 */
export async function generateOpenAiCompatibleImage(
  params: OpenAiCompatibleImageRequest,
): Promise<OpenAiCompatibleImageResult> {
  const batch = await generateOpenAiCompatibleImages({
    ...params,
    count: 1,
  });
  const first = batch.images[0];
  if (!first) {
    throw new Error("文生图服务未返回图片");
  }
  return {
    buffer: first.buffer,
    mimeType: first.mimeType,
    resolvedUrl: batch.resolvedUrl,
  };
}
