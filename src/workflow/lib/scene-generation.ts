import { saveAssetFile } from "@/workflow/lib/asset-storage";
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
  const { generateOpenAiCompatibleImage } = await import(
    "@/ai-config/openai-compatible-image"
  );
  const generated = await generateOpenAiCompatibleImage({
    endpoint: params.endpoint,
    apiKey: params.apiKey,
    prompt: params.prompt,
    aspectRatio: "16:9",
    extra: {
      sceneName: params.sceneName,
      kind: "scene",
    },
  });
  return {
    buffer: generated.buffer,
    mimeType: generated.mimeType,
    ext: generated.mimeType.includes("jpeg") ? ".jpg" : ".png",
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

  const { resolveAiCapabilityRuntimeConfig } = await import(
    "@/ai-config/resolve"
  );
  const resolved = await resolveAiCapabilityRuntimeConfig(
    "image.scene.generate",
  );
  const config = resolved.profile;
  const provider = config.provider;
  const endpoint = config.apiUrl.trim();

  const { buildAssembledImagePrompt } = await import(
    "@/ai-config/prompt-assembly"
  );
  const assembled = await buildAssembledImagePrompt({
    capabilityId: "image.scene.generate",
    userPrompt: prompt,
  });
  const effectivePrompt = assembled.finalPrompt;

  let buffer: Buffer;
  let mimeType: string;
  let fileName: string;
  let mode: "mock" | "http";
  let notice: string;

  if (provider === "http") {
    if (!endpoint) {
      throw new Error("未配置场景 API 地址，请管理员在「系统管理 → API 接口」中填写");
    }
    const generated = await generateViaHttp({
      endpoint,
      apiKey: config.apiKey,
      prompt: effectivePrompt,
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
      "当前为本地演示生成。管理员可在「系统管理 → API 接口」接入场景生成接口。";
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
      prompt: effectivePrompt,
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
