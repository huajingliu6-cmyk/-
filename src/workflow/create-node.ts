import type {
  CharacterNodeData,
  CharacterVariant,
  WorkflowDocument,
  WorkflowNode,
  WorkflowNodeType,
} from "./types";

export function createNodeId(type: WorkflowNodeType) {
  return `${type}-${crypto.randomUUID().slice(0, 8)}`;
}

function createDefaultCharacterVariant(): CharacterVariant {
  const id = `variant-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    name: "默认形象",
    ageStage: "",
    costume: "",
    referenceAssetIds: [],
    primaryAssetId: "",
    references: [],
    referenceVoiceAssetId: "",
  };
}

export function createDefaultCharacterData(): CharacterNodeData {
  const variant = createDefaultCharacterVariant();
  return {
    title: "角色",
    characterName: "",
    description: "",
    appearancePrompt: "",
    voicePrompt: "",
    voiceAssetId: "",
    imageModel: "AnyCook",
    stylePreset: "",
    aspectRatio: "9:16",
    resolution: "2K",
    primaryVariantId: variant.id,
    selectedVariantId: variant.id,
    variants: [variant],
    uploadStatus: "empty",
    appearanceStatus: "idle",
    voiceStatus: "idle",
    errorMessage: "",
    generationHistoryIds: [],
    voiceHistoryIds: [],
  };
}

export function createNodeByType(
  type: WorkflowNodeType,
  position: { x: number; y: number },
  shotNumber = 1,
): WorkflowNode {
  const id = createNodeId(type);

  switch (type) {
    case "character":
      return {
        id,
        type,
        position,
        data: createDefaultCharacterData(),
      };
    case "scene":
      return {
        id,
        type,
        position,
        data: {
          title: "场景",
          sceneName: "",
          description: "",
          generationPrompt: "",
          timeOfDay: "白天",
          weather: "晴",
          visualStyle: "",
          referenceAssetIds: [],
          primaryAssetId: "",
          viewpoints: [],
          immersivePreviewEnabled: false,
          uploadStatus: "empty",
          generationStatus: "idle",
          errorMessage: "",
          generationHistoryIds: [],
        },
      };
    case "videoShot":
      return {
        id,
        type,
        position,
        data: {
          title: `镜头 ${shotNumber}`,
          shotNumber,
          generationInstruction: "",
          duration: 5,
          shotSize: "medium",
          cameraAngle: "eyeLevel",
          cameraMovement: "static",
          actionDescription: "",
          colorTone: "",
          focalLength: "50mm",
          aspectRatio: "9:16",
          resolution: "720P",
          provider: "mock",
          model: "mock-wan27-t2v",
          stylePreset: "",
          referenceMode: "omni",
          creditEstimate: 50,
          attachedAssetIds: [],
          referenceSelectionMode: "auto",
          selectedReferenceAssetIds: [],
          continuityMode: "standalone",
          sourceVideoAssetId: "",
          startFrameAssetId: "",
          endFrameAssetId: "",
          status: "idle",
          progress: 0,
          errorMessage: "",
          resultAssetId: "",
          activeGenerationId: "",
          generationHistoryIds: [],
        },
      };
    case "image":
      return {
        id,
        type,
        position,
        data: {
          title: "图片参考",
          referenceType: "general",
          assetIds: [],
          primaryAssetId: "",
          selectedAssetIds: [],
          description: "",
          uploadStatus: "empty",
          errorMessage: "",
        },
      };
    case "text":
      return {
        id,
        type,
        position,
        data: {
          title: "文本",
          content: "",
          textType: "script",
        },
      };
    case "audio":
      return {
        id,
        type,
        position,
        data: {
          title: "音频",
          audioType: "voice",
          assetId: "",
          duration: 0,
          uploadStatus: "empty",
          errorMessage: "",
        },
      };
    case "prop":
      return {
        id,
        type,
        position,
        data: {
          title: "道具",
          propName: "",
          description: "",
          assetIds: [],
          primaryAssetId: "",
          uploadStatus: "empty",
          errorMessage: "",
        },
      };
  }
}

export function createEmptyDocument(
  projectId: string,
): WorkflowDocument {
  return {
    version: 4,
    projectId,
    revision: 0,
    updatedAt: new Date().toISOString(),
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    assets: [],
    shotOrder: [],
  };
}
