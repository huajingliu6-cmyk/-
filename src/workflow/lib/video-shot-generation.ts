import { saveAssetFile } from "@/workflow/lib/asset-storage";
import { getGenerationApiConfig } from "@/auth/api-config";
import type { AssetRecord } from "@/workflow/types";

export type VideoShotGenerationRequest = {
  projectId: string;
  videoShotNodeId: string;
  title: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  duration: number;
  resolution: string;
  stylePreset: string;
  referenceMode: string;
  cameraMovement: string;
};

export type VideoShotGenerationResult = {
  asset: AssetRecord;
  provider: string;
  mode: "mock" | "http";
  notice: string;
  creditEstimate: number;
};

function mockPngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

function estimateCredits(duration: number): number {
  return Math.max(1, Math.round(duration * 10));
}

async function generateViaHttp(params: {
  endpoint: string;
  apiKey: string;
  request: VideoShotGenerationRequest;
}): Promise<{ buffer: Buffer; mimeType: string; ext: string; fileName: string }> {
  const res = await fetch(params.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
    },
    body: JSON.stringify(params.request),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `模型服务返回错误（${res.status}）：${text.slice(0, 200) || res.statusText}`,
    );
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = (await res.json()) as {
      url?: string;
      base64?: string;
      mimeType?: string;
      error?: string;
    };
    if (json.error) throw new Error(json.error);
    if (json.base64) {
      const mimeType = json.mimeType || "image/png";
      const ext = mimeType.includes("mp4") ? ".mp4" : ".png";
      return {
        buffer: Buffer.from(json.base64, "base64"),
        mimeType,
        ext,
        fileName: `generated-shot${ext}`,
      };
    }
    if (json.url) {
      const fileRes = await fetch(json.url);
      if (!fileRes.ok) throw new Error("无法下载模型返回的素材 URL");
      const mimeType = fileRes.headers.get("content-type") || "image/png";
      const ext = mimeType.includes("mp4") ? ".mp4" : ".png";
      return {
        buffer: Buffer.from(await fileRes.arrayBuffer()),
        mimeType,
        ext,
        fileName: `generated-shot${ext}`,
      };
    }
    throw new Error("模型服务响应缺少 base64 或 url 字段");
  }

  const mimeType = contentType || "image/png";
  const ext = mimeType.includes("mp4") ? ".mp4" : ".png";
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    mimeType,
    ext,
    fileName: `generated-shot${ext}`,
  };
}

/**
 * 视频镜头生成。
 * mock：写入演示海报图（非真实视频）。
 * http：使用管理员配置的视频 API。
 */
export async function generateVideoShot(
  request: VideoShotGenerationRequest,
): Promise<VideoShotGenerationResult> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    throw new Error("请先填写短片内容描述");
  }

  const config = await getGenerationApiConfig("video-shot");
  const provider = config.provider;
  const endpoint = config.apiUrl.trim();
  const creditEstimate = estimateCredits(request.duration);

  if (provider === "http") {
    if (!endpoint) {
      throw new Error("未配置视频 API 地址，请管理员在「管理 API」中填写");
    }
    const generated = await generateViaHttp({
      endpoint,
      apiKey: config.apiKey,
      request,
    });
    const isVideoMime = generated.mimeType.startsWith("video/");
    const stored = await saveAssetFile({
      buffer: isVideoMime ? mockPngBuffer() : generated.buffer,
      mimeType: isVideoMime ? "image/png" : generated.mimeType,
      fileName: isVideoMime ? "generated-shot-poster.png" : generated.fileName,
      kind: "image",
      ext: isVideoMime ? ".png" : generated.ext,
    });
    const now = new Date().toISOString();
    const asset: AssetRecord = {
      id: stored.assetId,
      projectId: request.projectId,
      assetType: "generatedImage",
      name: `${request.title || "镜头"}·生成结果`,
      originalFileName: stored.fileName,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      url: stored.assetUrl,
      thumbnailUrl: stored.assetUrl,
      metadata: {
        source: "http-model",
        prompt,
        videoShotNodeId: request.videoShotNodeId,
        demo: false,
        rawWasVideo: isVideoMime,
      },
      createdAt: now,
      updatedAt: now,
    };
    return {
      asset,
      provider: "http",
      mode: "http",
      notice: isVideoMime
        ? "模型返回了视频流；当前本地存储以海报图预览（后续可接对象存储直存视频）"
        : "已通过配置的模型接口生成",
      creditEstimate,
    };
  }

  const stored = await saveAssetFile({
    buffer: mockPngBuffer(),
    mimeType: "image/png",
    fileName: "video-shot-demo.png",
    kind: "image",
    ext: ".png",
  });
  const now = new Date().toISOString();
  const asset: AssetRecord = {
    id: stored.assetId,
    projectId: request.projectId,
    assetType: "generatedImage",
    name: `${request.title || "镜头"}·演示结果`,
    originalFileName: stored.fileName,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    url: stored.assetUrl,
    thumbnailUrl: stored.assetUrl,
    metadata: {
      source: "mock",
      prompt,
      videoShotNodeId: request.videoShotNodeId,
      demo: true,
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    asset,
    provider: "mock",
    mode: "mock",
    notice:
      "当前为本地演示生成（海报占位，非真实视频）。管理员可在右上角账户 → 管理 API 中接入视频生成接口。",
    creditEstimate,
  };
}
