import { resolveAiCapabilityRuntimeConfig } from "@/ai-config/resolve";
import {
  getDesignPromptModel,
  isDesignPromptModelId,
} from "@/projects/assets/episode-design/design-prompt-models";
import {
  assetExtractionPhaseToCapabilityId,
  type AssetExtractionPhase,
} from "@/projects/assets/extraction/extraction-capabilities";
import { HttpCompatibleTextProvider } from "@/text-generation/provider/http-compatible-provider";
import { MockTextProvider } from "@/text-generation/provider/mock-provider";
import type { TextGenerationProvider } from "@/text-generation/provider/types";

function resolveProviderModelId(input: {
  modelKey: string;
  profileModel: string;
}): string {
  if (isDesignPromptModelId(input.modelKey)) {
    return getDesignPromptModel(input.modelKey).providerModelId;
  }
  return input.profileModel.trim() || input.modelKey;
}

export async function resolveExtractionTextProvider(input: {
  phase: AssetExtractionPhase;
  modelKey: string;
}): Promise<{
  provider: TextGenerationProvider;
  providerModelId: string;
  capabilityId: ReturnType<typeof assetExtractionPhaseToCapabilityId>;
}> {
  const capabilityId = assetExtractionPhaseToCapabilityId(input.phase);
  const resolved = await resolveAiCapabilityRuntimeConfig(capabilityId);
  const providerModelId = resolveProviderModelId({
    modelKey: input.modelKey,
    profileModel: resolved.profile.model ?? "",
  });
  if (resolved.profile.provider === "mock") {
    return {
      provider: new MockTextProvider(),
      providerModelId,
      capabilityId,
    };
  }
  if (resolved.profile.provider === "http" && resolved.secret) {
    return {
      provider: new HttpCompatibleTextProvider(
        resolved.secret,
        resolved.profile.apiUrl,
        providerModelId,
      ),
      providerModelId,
      capabilityId,
    };
  }
  return {
    provider: new MockTextProvider(),
    providerModelId,
    capabilityId,
  };
}
