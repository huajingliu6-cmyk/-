export type TextModelPublic = {
  publicKey: string;
  displayName: string;
  description: string;
  qualityTier: "fast" | "balanced" | "quality";
  recommended: boolean;
  supportsStreaming: boolean;
  maxInputChars: number;
};

export type TextModelInternal = TextModelPublic & {
  provider: "dashscope" | "mock";
  providerModelId: string;
  enabled: boolean;
  maxOutputTokensCap: number;
  /** 中文目标字数 → output token 预算的保守系数（可按模型调） */
  charsToOutputTokensFactor: number;
  /** DEV 测试定价：每 1k token 积分（生产待确认） */
  pointsPer1kInput: number;
  pointsPer1kOutput: number;
};

function envModelId(): string {
  return (
    process.env.TEXT_LLM_MODEL_ID?.trim() ||
    process.env.DASHSCOPE_TEXT_MODEL_ID?.trim() ||
    "qwen-plus"
  );
}

function buildRegistry(): TextModelInternal[] {
  const providerModelId = envModelId();
  const providerRaw = (process.env.TEXT_LLM_PROVIDER ?? "mock")
    .trim()
    .toLowerCase();
  const provider: "dashscope" | "mock" =
    providerRaw === "dashscope" ? "dashscope" : "mock";

  // DEV 测试定价（明确标记）；正式倍率 TODO
  const inputPts = Number(process.env.TEXT_POINTS_PER_1K_INPUT ?? "1") || 1;
  const outputPts = Number(process.env.TEXT_POINTS_PER_1K_OUTPUT ?? "2") || 2;

  return [
    {
      publicKey: "balanced-default",
      displayName: "均衡模型",
      description: "推荐，质量和成本平衡",
      qualityTier: "balanced",
      recommended: true,
      supportsStreaming: true,
      maxInputChars: 3000,
      provider,
      providerModelId,
      enabled: true,
      maxOutputTokensCap: 30000,
      charsToOutputTokensFactor: 1.35,
      pointsPer1kInput: inputPts,
      pointsPer1kOutput: outputPts,
    },
  ];
}

export function listPublicTextModels(): TextModelPublic[] {
  return buildRegistry()
    .filter((m) => m.enabled)
    .map(
      ({
        publicKey,
        displayName,
        description,
        qualityTier,
        recommended,
        supportsStreaming,
        maxInputChars,
      }) => ({
        publicKey,
        displayName,
        description,
        qualityTier,
        recommended,
        supportsStreaming,
        maxInputChars,
      }),
    );
}

export function getTextModelByKey(
  publicKey: string,
): TextModelInternal | null {
  return (
    buildRegistry().find((m) => m.enabled && m.publicKey === publicKey) ??
    null
  );
}

export function getRecommendedModelKey(): string {
  const rec = buildRegistry().find((m) => m.enabled && m.recommended);
  return rec?.publicKey ?? "balanced-default";
}

export function estimateOutputTokenBudget(
  model: TextModelInternal,
  targetChars: number,
): number {
  const raw = Math.ceil(targetChars * model.charsToOutputTokensFactor) + 48;
  return Math.min(model.maxOutputTokensCap, Math.max(64, raw));
}
