import {
  DEFAULT_DESIGN_PROMPT_MODEL_ID,
  DESIGN_PROMPT_MODELS,
  isDesignPromptModelId,
} from "@/projects/assets/episode-design/design-prompt-models";
import { DEFAULT_ASSET_EXTRACTION_MODEL_KEY } from "@/projects/assets/extraction/types";

export const ASSET_EXTRACTION_MODEL_OPTIONS = DESIGN_PROMPT_MODELS.map(
  (model) => ({
    id: model.id,
    label: model.label,
  }),
);

export function resolveAssetExtractionModelKey(value: unknown): string {
  if (isDesignPromptModelId(value)) return value;
  return DEFAULT_DESIGN_PROMPT_MODEL_ID;
}

export function defaultAssetExtractionModelKey(): string {
  return DEFAULT_ASSET_EXTRACTION_MODEL_KEY;
}
