import { saveAssetFile } from "@/workflow/lib/asset-storage";
import type { AssetRecord, AssetType } from "@/workflow/types";

export type CharacterGenKind = "appearance" | "voice";

export type CharacterGenerationRequest = {
  projectId: string;
  characterNodeId: string;
  characterName: string;
  prompt: string;
  kind: CharacterGenKind;
  model?: string;
  stylePreset?: string;
  aspectRatio?: string;
  resolution?: string;
};

export type CharacterGenerationResult = {
  asset: AssetRecord;
  provider: string;
  mode: "mock" | "http";
  notice: string;
};

/** 最小合法 PNG（1x1），仅用于本地演示生成 */
function mockPngBuffer(label: string): Buffer {
  void label;
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

/** 生成约 0.3s 的简单正弦 WAV，仅用于本地演示 */
function mockWavBuffer(): Buffer {
  const sampleRate = 22050;
  const durationSec = 0.35;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * 440 * t) * 0.2;
    buffer.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2);
  }
  return buffer;
}

async function saveGeneratedAsset(params: {
  projectId: string;
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  kind: "image" | "audio";
  ext: string;
  assetType: AssetType;
  name: string;
  metadata: Record<string, string | number | boolean | null>;
}): Promise<AssetRecord> {
  const stored = await saveAssetFile({
    buffer: params.buffer,
    mimeType: params.mimeType,
    fileName: params.fileName,
    kind: params.kind,
    ext: params.ext,
  });
  const now = new Date().toISOString();
  return {
    id: stored.assetId,
    projectId: params.projectId,
    assetType: params.assetType,
    name: params.name,
    originalFileName: stored.fileName,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    url: stored.assetUrl,
    thumbnailUrl: params.kind === "image" ? stored.assetUrl : "",
    metadata: params.metadata,
    createdAt: now,
    updatedAt: now,
  };
}

async function generateViaHttp(params: {
  endpoint: string;
  apiKey: string;
  prompt: string;
  kind: CharacterGenKind;
  characterName: string;
  model?: string;
  stylePreset?: string;
  aspectRatio?: string;
  resolution?: string;
}): Promise<{ buffer: Buffer; mimeType: string; ext: string; fileName: string }> {
  if (params.kind === "appearance") {
    const { generateOpenAiCompatibleImage } = await import(
      "@/ai-config/openai-compatible-image"
    );
    const generated = await generateOpenAiCompatibleImage({
      endpoint: params.endpoint,
      apiKey: params.apiKey,
      prompt: params.prompt,
      model: params.model,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      extra: {
        characterName: params.characterName,
        kind: params.kind,
        ...(params.stylePreset ? { stylePreset: params.stylePreset } : {}),
      },
    });
    const ext = generated.mimeType.includes("jpeg") ? ".jpg" : ".png";
    return {
      buffer: generated.buffer,
      mimeType: generated.mimeType,
      ext,
      fileName: `generated-appearance${ext}`,
    };
  }

  const res = await fetch(params.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
    },
    body: JSON.stringify({
      prompt: params.prompt,
      characterName: params.characterName,
      kind: params.kind,
      model: params.model,
      stylePreset: params.stylePreset,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
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
      const mimeType = json.mimeType || "audio/wav";
      return {
        buffer: Buffer.from(json.base64, "base64"),
        mimeType,
        ext: ".wav",
        fileName: "generated-voice.wav",
      };
    }
    if (json.url) {
      const fileRes = await fetch(json.url);
      if (!fileRes.ok) throw new Error("无法下载模型返回的素材 URL");
      const mimeType = fileRes.headers.get("content-type") || "audio/wav";
      return {
        buffer: Buffer.from(await fileRes.arrayBuffer()),
        mimeType,
        ext: ".wav",
        fileName: "generated-voice.wav",
      };
    }
    throw new Error("模型服务响应缺少 base64 或 url 字段");
  }

  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    mimeType: contentType || "audio/wav",
    ext: ".wav",
    fileName: "generated-voice.wav",
  };
}

/**
 * 角色外貌/声音生成。
 * - mock：本地演示素材（非真实 AI）
 * - http：使用管理员在「管理 API」中配置的地址与密钥
 */
export async function generateCharacterMedia(
  request: CharacterGenerationRequest,
): Promise<CharacterGenerationResult> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    throw new Error(
      request.kind === "appearance"
        ? "请先填写角色外貌描述"
        : "请先填写角色声音描述",
    );
  }

  const capabilityId =
    request.kind === "appearance"
      ? "image.character.generate"
      : "audio.character-voice.generate";
  const { resolveAiCapabilityRuntimeConfig } = await import(
    "@/ai-config/resolve"
  );
  const resolved = await resolveAiCapabilityRuntimeConfig(capabilityId);
  const config = resolved.profile;
  const provider = config.provider;
  const endpoint = config.apiUrl.trim();

  let effectivePrompt = prompt;
  if (request.kind === "appearance") {
    const { buildAssembledImagePrompt } = await import(
      "@/ai-config/prompt-assembly"
    );
    const assembled = await buildAssembledImagePrompt({
      capabilityId: "image.character.generate",
      userPrompt: prompt,
    });
    effectivePrompt = assembled.finalPrompt;
  }

  if (provider === "http") {
    if (!endpoint) {
      throw new Error(
        request.kind === "appearance"
          ? "未配置角色外貌 API 地址，请管理员在「系统管理 → API 接口」中填写"
          : "未配置角色声音 API 地址，请管理员在「系统管理 → API 接口」中填写",
      );
    }

    const generated = await generateViaHttp({
      endpoint,
      apiKey: config.apiKey,
      prompt: effectivePrompt,
      kind: request.kind,
      characterName: request.characterName,
      model: request.model,
      stylePreset: request.stylePreset,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
    });

    const asset = await saveGeneratedAsset({
      projectId: request.projectId,
      buffer: generated.buffer,
      mimeType: generated.mimeType,
      fileName: generated.fileName,
      kind: request.kind === "appearance" ? "image" : "audio",
      ext: generated.ext,
      assetType:
        request.kind === "appearance" ? "characterImage" : "audio",
      name:
        request.kind === "appearance"
          ? `${request.characterName || "角色"}·AI外貌`
          : `${request.characterName || "角色"}·AI声音`,
      metadata: {
        source: "http-model",
        prompt: effectivePrompt,
        characterNodeId: request.characterNodeId,
        demo: false,
        ...(request.model ? { model: request.model } : {}),
        ...(request.stylePreset ? { stylePreset: request.stylePreset } : {}),
        ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
        ...(request.resolution ? { resolution: request.resolution } : {}),
      },
    });

    return {
      asset,
      provider: "http",
      mode: "http",
      notice: "已通过配置的模型接口生成",
    };
  }

  // 默认 mock：可跑通流程，明确标注演示
  if (request.kind === "appearance") {
    const asset = await saveGeneratedAsset({
      projectId: request.projectId,
      buffer: mockPngBuffer(prompt),
      mimeType: "image/png",
      fileName: "character-appearance-demo.png",
      kind: "image",
      ext: ".png",
      assetType: "characterImage",
      name: `${request.characterName || "角色"}·演示外貌`,
      metadata: {
        source: "mock",
        prompt: effectivePrompt,
        characterNodeId: request.characterNodeId,
        demo: true,
        model: request.model || "AnyCook",
        stylePreset: request.stylePreset || "",
        aspectRatio: request.aspectRatio || "9:16",
        resolution: request.resolution || "2K",
      },
    });
    return {
      asset,
      provider: "mock",
      mode: "mock",
      notice:
        "当前为本地演示生成（未连接真实图片服务）。管理员可在「系统管理 → API 接口」接入外貌生成接口。",
    };
  }

  const asset = await saveGeneratedAsset({
    projectId: request.projectId,
    buffer: mockWavBuffer(),
    mimeType: "audio/wav",
    fileName: "character-voice-demo.wav",
    kind: "audio",
    ext: ".wav",
    assetType: "audio",
    name: `${request.characterName || "角色"}·演示声音`,
    metadata: {
      source: "mock",
      prompt,
      characterNodeId: request.characterNodeId,
      demo: true,
    },
  });

  return {
    asset,
    provider: "mock",
    mode: "mock",
    notice:
      "当前为本地演示生成（未连接真实声音模型）。管理员可在「系统管理 → API 接口」接入声音生成接口。",
  };
}
