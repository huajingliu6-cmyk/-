/**
 * Structured descriptors for every active AI capability.
 * Coverage tests assert registry ↔ route ↔ resolver consistency.
 */
import type { AiCapabilityId } from "@/ai-config/capabilities";

export type AiActionDescriptor = {
  capabilityId: AiCapabilityId;
  surface: string;
  component: string;
  serverRoute: string;
  resolverEntry: string;
  providerAdapter: string;
  active: boolean;
  testModule: string;
};

export const AI_ACTION_DESCRIPTORS: readonly AiActionDescriptor[] = [
  {
    capabilityId: "story.generate",
    surface: "StoryCreationWorkspace",
    component: "StoryInputPanel",
    serverRoute: "POST /api/projects/[projectId]/text-generations",
    resolverEntry: "resolveCapabilityForOutputKind(story)",
    providerAdapter: "MockTextProvider | HttpCompatibleTextProvider",
    active: true,
    testModule: "src/projects/story/__tests__/story-text-generations-route.test.ts",
  },
  {
    capabilityId: "script.outline.generate",
    surface: "StoryCreationWorkspace",
    component: "ScriptGenerationConfig",
    serverRoute: "POST /api/projects/[projectId]/text-generations",
    resolverEntry: "resolveCapabilityForOutputKind(script_outline)",
    providerAdapter: "MockTextProvider | HttpCompatibleTextProvider",
    active: true,
    testModule:
      "src/projects/story/__tests__/script-outline-route.test.ts",
  },
  {
    capabilityId: "asset.episode-design.generate",
    surface: "AssetManagementWorkspace / episode-design",
    component: "EpisodeAssetDesignPanel",
    serverRoute: "POST /api/projects/[projectId]/text-generations",
    resolverEntry: "resolveCapabilityForOutputKind(episode_asset_design)",
    providerAdapter: "MockTextProvider | HttpCompatibleTextProvider",
    active: true,
    testModule:
      "src/projects/assets/__tests__/episode-asset-design-generate-route.test.ts",
  },
  {
    capabilityId: "script.split.generate",
    surface: "ScriptCreationWorkspace / intelligent-split",
    component: "ScriptCreationWorkspace",
    serverRoute: "POST /api/projects/[projectId]/text-generations",
    resolverEntry: "resolveCapabilityForOutputKind(script_split)",
    providerAdapter: "MockTextProvider | HttpCompatibleTextProvider",
    active: true,
    testModule: "src/projects/script/__tests__/script-split-boundary.test.ts",
  },
  {
    capabilityId: "asset.design-prompt.generate",
    surface: "EpisodeAssetDesignWorkspace / design-prompt",
    component: "DesignAssetModal",
    serverRoute:
      "POST /api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-prompt",
    resolverEntry:
      "resolveAiCapabilityRuntimeConfig(asset.design-prompt.generate)",
    providerAdapter: "MockTextProvider | HttpCompatibleTextProvider",
    active: true,
    testModule: "src/projects/assets/__tests__/design-asset-card-ui.test.ts",
  },
  {
    capabilityId: "text.storyboard-prompt.generate",
    surface: "StoryboardProductionPanel",
    component: "StoryboardProductionPanel",
    serverRoute:
      "POST /api/projects/[projectId]/storyboard-workspace/episodes/[episodeId]/storyboard/generate",
    resolverEntry: "resolveCapabilityForOutputKind(storyboard_prompt)",
    providerAdapter: "MockTextProvider | HttpCompatibleTextProvider",
    active: true,
    testModule:
      "src/projects/storyboard/__tests__/storyboard-prompt-llm.test.ts",
  },
  {
    capabilityId: "image.character.generate",
    surface: "Workflow CharacterPromptPanel",
    component: "CharacterPromptPanel",
    serverRoute: "POST /api/generate/character-image",
    resolverEntry: "resolveAiCapabilityRuntimeConfig(image.character.generate)",
    providerAdapter: "character-generation mock|http",
    active: true,
    testModule: "src/ai-config/__tests__/active-capability-coverage.test.ts",
  },
  {
    capabilityId: "audio.character-voice.generate",
    surface: "Workflow CharacterPromptPanel",
    component: "CharacterPromptPanel",
    serverRoute: "POST /api/generate/character-voice",
    resolverEntry:
      "resolveAiCapabilityRuntimeConfig(audio.character-voice.generate)",
    providerAdapter: "character-generation mock|http",
    active: true,
    testModule: "src/ai-config/__tests__/active-capability-coverage.test.ts",
  },
  {
    capabilityId: "image.scene.generate",
    surface: "Workflow ScenePromptPanel",
    component: "ScenePromptPanel",
    serverRoute: "POST /api/generate/scene-image",
    resolverEntry: "resolveAiCapabilityRuntimeConfig(image.scene.generate)",
    providerAdapter: "scene-generation mock|http",
    active: true,
    testModule: "src/ai-config/__tests__/active-capability-coverage.test.ts",
  },
  {
    capabilityId: "image.prop.generate",
    surface: "EpisodeAssetDesignWorkspace / prop-image",
    component: "DesignAssetModal",
    serverRoute:
      "POST /api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-asset",
    resolverEntry: "resolveAiCapabilityRuntimeConfig(image.prop.generate)",
    providerAdapter: "mock PNG write | http prop-image",
    active: true,
    testModule: "src/projects/assets/__tests__/design-asset-card-ui.test.ts",
  },
  {
    capabilityId: "video.reference-image.precheck",
    surface: "Asset image upload / video reference precheck",
    component: "EpisodeAssetDesignPanel | DesignAssetModal",
    serverRoute:
      "PUT /api/projects/[projectId]/assets-draft/images/[assetId]",
    resolverEntry: "resolveArkVisionPrecheckRuntime()",
    providerAdapter: "Ark multimodal chat completions | mock fallback",
    active: true,
    testModule:
      "src/video-generation/__tests__/ark-image-safety-precheck.test.ts",
  },
  {
    capabilityId: "video.storyboard-shot.generate",
    surface: "StoryboardProductionPanel",
    component: "ShotVideoGenerationButton",
    serverRoute:
      "POST /api/projects/[projectId]/storyboard-workspace/episodes/[episodeId]/storyboard/shots/[shotId]/generate-video",
    resolverEntry:
      "resolveVideoProviderRuntimeConfig(video.storyboard-shot.generate)",
    providerAdapter: "Mock | Http | AliyunWan27",
    active: true,
    testModule: "src/ai-config/__tests__/video-paid-gate-routes.test.ts",
  },
  {
    capabilityId: "video.storyboard-episode.generate",
    surface: "StoryboardProductionPanel",
    component: "EpisodeVideoGenerationButton",
    serverRoute:
      "POST /api/projects/[projectId]/storyboard-workspace/episodes/[episodeId]/storyboard/generate-videos",
    resolverEntry:
      "resolveVideoProviderRuntimeConfig(video.storyboard-episode.generate)",
    providerAdapter: "Mock | Http | AliyunWan27",
    active: true,
    testModule: "src/ai-config/__tests__/video-paid-gate-routes.test.ts",
  },
  {
    capabilityId: "video.workflow-node.generate",
    surface: "Workflow VideoPromptPanel",
    component: "GenerationConfirmationDrawer",
    serverRoute: "POST /api/generations",
    resolverEntry:
      "resolveVideoProviderRuntimeConfig(video.workflow-node.generate)",
    providerAdapter: "Mock | Http | AliyunWan27",
    active: true,
    testModule: "src/ai-config/__tests__/video-paid-gate-routes.test.ts",
  },
] as const;
