import { createHash } from "crypto";
import type { DirectorSettings, VideoGenerationInput } from "../types";

/** 稳定 JSON：对象键排序；数组保序（顺序有语义时保留）。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type GenerationFingerprintInput = {
  projectId: string;
  shotNodeId: string;
  providerId: string;
  modelId: string;
  /** 生成指令正文；仅哈希入指纹，不落持久化明文 */
  generationInstruction: string;
  resolution: string;
  aspectRatio: string | null;
  durationSeconds: number;
  /** 顺序有意义，保留 */
  selectedReferenceAssetIds: string[];
  firstFrameAssetId: string | null;
  directorSettings?: DirectorSettings | null;
  seed?: number | null;
  watermark?: boolean;
  promptExtend?: boolean;
};

/**
 * 纯函数：相同规范化输入 → 相同 fingerprint。
 * 不包含 API Key、confirmPaidGeneration、素材二进制/base64/签名 URL。
 */
export function buildGenerationRequestFingerprint(
  input: GenerationFingerprintInput,
): string {
  const director = normalizeDirectorSettings(input.directorSettings);
  const payload = {
    projectId: input.projectId,
    shotNodeId: input.shotNodeId,
    providerId: input.providerId,
    modelId: input.modelId,
    generationInstructionHash: sha256Hex(input.generationInstruction),
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    selectedReferenceAssetIds: [...input.selectedReferenceAssetIds],
    firstFrameAssetId: input.firstFrameAssetId,
    directorSettings: director,
    seed: input.seed ?? null,
    watermark: input.watermark ?? false,
    promptExtend: input.promptExtend ?? true,
  };
  return sha256Hex(stableStringify(payload));
}

function normalizeDirectorSettings(
  settings: DirectorSettings | null | undefined,
): Record<string, string> | null {
  if (!settings) return null;
  const out: Record<string, string> = {};
  const keys = Object.keys(settings).sort() as Array<keyof DirectorSettings>;
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === "string" && value.length > 0) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 从已校验的 VideoGenerationInput 构建指纹输入（密钥不参与）。 */
export function fingerprintInputFromGeneration(params: {
  input: VideoGenerationInput;
  providerId: string;
  modelId: string;
}): GenerationFingerprintInput {
  const { input, providerId, modelId } = params;
  return {
    projectId: input.projectId,
    shotNodeId: input.shotId,
    providerId,
    modelId,
    generationInstruction: input.prompt,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    selectedReferenceAssetIds: [...input.selectedReferenceAssetIds],
    firstFrameAssetId: input.firstFrame?.assetId ?? null,
    directorSettings: input.directorSettings ?? null,
    seed: input.seed ?? null,
    watermark: input.watermark,
    promptExtend: input.promptExtend,
  };
}
