export const DESIGN_PROMPT_MODELS = [
  {
    id: "deepseek-v4-pro",
    label: "Deepseek V4 Pro",
    providerModelId: "deepseek-v4-pro",
  },
] as const;

export type DesignPromptModelId =
  (typeof DESIGN_PROMPT_MODELS)[number]["id"];

export const DEFAULT_DESIGN_PROMPT_MODEL_ID: DesignPromptModelId =
  "deepseek-v4-pro";

export function isDesignPromptModelId(
  value: unknown,
): value is DesignPromptModelId {
  return (
    typeof value === "string" &&
    DESIGN_PROMPT_MODELS.some((model) => model.id === value)
  );
}

export function getDesignPromptModel(modelId: DesignPromptModelId) {
  return DESIGN_PROMPT_MODELS.find((model) => model.id === modelId)!;
}
