export const DESIGN_IMAGE_MODELS = [
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
  },
  {
    id: "gpt-image-2-adobe",
    label: "GPT Image 2 Adobe",
  },
  {
    id: "gemini-banana-2.0-pro",
    label: "Gemini Banana 2.0 Pro",
  },
] as const;

export type DesignImageModelId =
  (typeof DESIGN_IMAGE_MODELS)[number]["id"];

export const DEFAULT_DESIGN_IMAGE_MODEL_ID =
  "gpt-image-2" as DesignImageModelId;

export function isDesignImageModelId(
  value: unknown,
): value is DesignImageModelId {
  return DESIGN_IMAGE_MODELS.some((model) => model.id === value);
}
