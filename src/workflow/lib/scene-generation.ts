import { saveAssetFile } from "@/workflow/lib/asset-storage";
import { getGenerationApiConfig } from "@/auth/api-config";
import type { AssetRecord } from "@/workflow/types";

export type SceneGenerationRequest = {
  projectId: string;
  sceneNodeId: string;
  sceneName: string;
  prompt: string;
};

export type SceneGenerationResult = {
  asset: AssetRecord;
  provider: string;
  mode: "mock" | "http";
  notice: string;
};

function mockPngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

async function generateViaHttp(params: {
  endpoint: string;
  apiKey: string;
  prompt: string;
  sceneName: string;
}): Promise<{ buffer: Buffer; mimeType: string; ext: string; fileName: string }> {
  const res = await fetch(params.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
    },
    body: JSON.stringify({
      prompt: params.prompt,
      sceneName: params.sceneName,
      kind: "scene",
    }),
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
      return {
        buffer: Buffer.from(json.base64, "base64"),
        mimeType,
        ext: ".png",
        fileName: "generated-scene.png",
      };
    }
    if (json.url) {
      const fileRes = await fetch(json.url);
      if (!fileRes.ok) throw new Error("无法下载模型返回的素材 URL");
      const mimeType = fileRes.headers.get("content-type") || "image/png";
      return {
        buffer: Buffer.from(await fileRes.arrayBuffer()),
        mimeType,
        ext: ".png",
        fileName: "generated-scene.png",
      };
    }
    throw new Error("模型服务响应缺少 base64 或 url 字段");
  }

  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    mimeType: contentType || "image/png",
    ext: ".png",
    fileName: "generated-scene.png",
  };
}

/**
 * 场景图片生成。
 * - mock：本地演示图
 * - http：使用管理员配置的场景 API
 */
export async function generateSceneImage(
  request: SceneGenerationRequest,
): Promise<SceneGenerationResult> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    throw new Error("请先填写场景描述");
  }

  const config = await getGenerationApiConfig("scene-image");
  const provider = config.provider;
  const endpoint = config.apiUrl.trim();

  let buffer: Buffer;
  let mimeType: string;
  let fileName: string;
  let mode: "mock" | "http";
  let notice: string;

  if (provider === "http") {
    if (!endpoint) {
      throw new Error("未配置场景 API 地址，请管理员在「管理 API」中填写");
    }
    const generated = await generateViaHttp({
      endpoint,
      apiKey: config.apiKey,
      prompt,
      sceneName: request.sceneName,
    });
    buffer = generated.buffer;
    mimeType = generated.mimeType;
    fileName = generated.fileName;
    mode = "http";
    notice = "已通过配置的模型接口生成场景图";
  } else {
    buffer = mockPngBuffer();
    mimeType = "image/png";
    fileName = "scene-demo.png";
    mode = "mock";
    notice =
      "当前为本地演示生成。管理员可在右上角账户 → 管理 API 中接入场景生成接口。";
  }

  const stored = await saveAssetFile({
    buffer,
    mimeType,
    fileName,
    kind: "image",
    ext: ".png",
  });
  const now = new Date().toISOString();
  const asset: AssetRecord = {
    id: stored.assetId,
    projectId: request.projectId,
    assetType: "sceneImage",
    name: `${request.sceneName || "场景"}·${mode === "mock" ? "演示" : "AI"}场景`,
    originalFileName: stored.fileName,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    url: stored.assetUrl,
    thumbnailUrl: stored.assetUrl,
    metadata: {
      source: mode === "mock" ? "mock" : "http-model",
      prompt,
      sceneNodeId: request.sceneNodeId,
      demo: mode === "mock",
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    asset,
    provider: mode,
    mode,
    notice,
  };
}
