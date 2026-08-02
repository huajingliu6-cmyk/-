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
  /** Extra metadata fields some proxies accept */
  extra?: Record<string, unknown>;
};

export type OpenAiCompatibleImageResult = {
  buffer: Buffer;
  mimeType: string;
  resolvedUrl: string;
};

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
  if (raw === "9:16") return "9:16";
  if (raw === "1:1") return "1:1";
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

/**
 * Pixel size for providers that want WIDTHxHEIGHT.
 * 4K 16:9 → 3840x2160 (not 1536x1024 / 1080P).
 */
export function mapImageSize(params: {
  aspectRatio?: string;
  resolution?: string;
}): string {
  const aspect = normalizeImageAspectRatio(params.aspectRatio);
  const tier = normalizeImageResolutionTier(params.resolution);

  if (aspect === "9:16") {
    if (tier === "4k") return "2160x3840";
    if (tier === "2k") return "1440x2560";
    return "1080x1920";
  }
  if (aspect === "1:1") {
    if (tier === "4k") return "2160x2160";
    if (tier === "2k") return "2048x2048";
    return "1024x1024";
  }
  // 16:9
  if (tier === "4k") return "3840x2160";
  if (tier === "2k") return "2560x1440";
  return "1920x1080";
}

function extractImagePayload(json: Record<string, unknown>): {
  base64?: string;
  url?: string;
  mimeType?: string;
} {
  if (typeof json.base64 === "string" && json.base64.trim()) {
    return {
      base64: json.base64,
      mimeType: typeof json.mimeType === "string" ? json.mimeType : undefined,
    };
  }
  if (typeof json.url === "string" && json.url.trim()) {
    return { url: json.url };
  }
  const data = json.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const row = first as Record<string, unknown>;
      if (typeof row.b64_json === "string" && row.b64_json.trim()) {
        return { base64: row.b64_json, mimeType: "image/png" };
      }
      if (typeof row.url === "string" && row.url.trim()) {
        return { url: row.url };
      }
      if (typeof row.base64 === "string" && row.base64.trim()) {
        return {
          base64: row.base64,
          mimeType:
            typeof row.mimeType === "string" ? row.mimeType : "image/png",
        };
      }
    }
  }
  const output = json.output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const out = output as Record<string, unknown>;
    const results = out.results;
    if (Array.isArray(results) && results[0] && typeof results[0] === "object") {
      const row = results[0] as Record<string, unknown>;
      if (typeof row.url === "string") return { url: row.url };
      if (typeof row.b64_json === "string") return { base64: row.b64_json };
    }
  }
  return {};
}

async function parseImageSuccessResponse(
  res: Response,
  resolvedUrl: string,
): Promise<OpenAiCompatibleImageResult> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mimeType: contentType || "image/png",
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

  const extracted = extractImagePayload(json);
  if (extracted.base64) {
    return {
      buffer: Buffer.from(extracted.base64, "base64"),
      mimeType: extracted.mimeType || "image/png",
      resolvedUrl,
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
      resolvedUrl,
    };
  }

  throw new Error(
    "文生图服务响应缺少图片数据（期望 data[].b64_json / data[].url）",
  );
}

/**
 * POST OpenAI-compatible `/images/generations` (or already-absolute image route).
 *
 * codesonline / gpt-image-2 style: `size` = aspect ("16:9"), `resolution` = "4k".
 */
export async function generateOpenAiCompatibleImage(
  params: OpenAiCompatibleImageRequest,
): Promise<OpenAiCompatibleImageResult> {
  const resolvedUrl = resolveOpenAiCompatibleImageEndpoint(params.endpoint);
  const aspect = normalizeImageAspectRatio(params.aspectRatio);
  const tier = normalizeImageResolutionTier(params.resolution);
  const pixelSize = mapImageSize({
    aspectRatio: aspect,
    resolution: tier.toUpperCase(),
  });

  const body: Record<string, unknown> = {
    prompt: params.prompt,
    n: 1,
    ...(params.model ? { model: params.model } : {}),
    quality: "high",
    // Primary contract for gpt-image-2 proxies (codesonline / toapis…)
    size: aspect,
    resolution: tier,
    aspect_ratio: aspect,
    // Explicit 4K pixel hint for gateways that read WIDTHxHEIGHT
    output_size: pixelSize,
    width: Number(pixelSize.split("x")[0]),
    height: Number(pixelSize.split("x")[1]),
    upscale: tier === "4k" ? "4K" : tier.toUpperCase(),
    ...(params.extra ?? {}),
  };

  const res = await fetch(resolvedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.apiKey
        ? { Authorization: `Bearer ${params.apiKey}` }
        : {}),
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
          `${message || "当前 API Key 无权调用该图片模型"}。请到「管理 API」→「角色外貌生成」更换有权限的模型名，或更换可用的 API Key。`,
        );
      }
      // Retry with pure pixel size if gateway rejects aspect-style size
      if (
        res.status === 400 &&
        (/size|resolution|unmarshal|invalid/i.test(message) ||
          /size|resolution|unmarshal|invalid/i.test(detail))
      ) {
        const retryBody: Record<string, unknown> = {
          prompt: params.prompt,
          n: 1,
          size: pixelSize,
          quality: "high",
          ...(params.model ? { model: params.model } : {}),
          resolution: tier,
          aspect_ratio: aspect,
          upscale: tier === "4k" ? "4K" : tier.toUpperCase(),
          ...(params.extra ?? {}),
        };
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
          return parseImageSuccessResponse(retry, resolvedUrl);
        }
        const retryText = await retry.text();
        detail = `${message || detail}；像素尺寸重试亦失败：${retryText.slice(0, 160)}`;
      } else if (message) {
        detail = message;
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("管理 API")) throw e;
    }
    throw new Error(
      `文生图服务返回错误（${res.status}）：${detail}（请求 ${resolvedUrl}）`,
    );
  }

  return parseImageSuccessResponse(res, resolvedUrl);
}
