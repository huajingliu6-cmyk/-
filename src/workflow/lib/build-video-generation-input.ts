import { HANDLES } from "../connection-rules";
import type {
  AssetRecord,
  AudioNode,
  CharacterNode,
  ImageNode,
  PropNode,
  SceneNode,
  TextNode,
  VideoGenerationInput,
  VideoGenerationInputResult,
  VideoShotNode,
  WorkflowDocument,
  WorkflowNode,
} from "../types";

function incomingSources(
  document: WorkflowDocument,
  videoNodeId: string,
): WorkflowNode[] {
  return document.edges
    .filter(
      (edge) =>
        edge.target === videoNodeId && edge.targetHandle === HANDLES.in,
    )
    .map((edge) => document.nodes.find((n) => n.id === edge.source))
    .filter((n): n is WorkflowNode => Boolean(n));
}

function assetById(
  assets: AssetRecord[],
  assetId: string,
): AssetRecord | undefined {
  if (!assetId) return undefined;
  return assets.find((asset) => asset.id === assetId);
}

function assetUrl(assets: AssetRecord[], assetId: string): string {
  return assetById(assets, assetId)?.url ?? "";
}

function resolveCharacterVariant(node: CharacterNode) {
  const selected =
    node.data.variants.find(
      (variant) => variant.id === node.data.selectedVariantId,
    ) ??
    node.data.variants.find(
      (variant) => variant.id === node.data.primaryVariantId,
    ) ??
    node.data.variants[0];

  return selected ?? null;
}

/**
 * 纯函数：汇总连接到指定 VideoShotNode 的全部输入。
 */
export function buildVideoGenerationInput(
  document: WorkflowDocument,
  videoShotNodeId: string,
): VideoGenerationInputResult {
  const videoNode = document.nodes.find(
    (n): n is VideoShotNode =>
      n.id === videoShotNodeId && n.type === "videoShot",
  );

  if (!videoNode) {
    return { ok: false, errors: ["未找到镜头节点"] };
  }

  const { assets } = document;
  const incoming = incomingSources(document, videoShotNodeId);

  const characters = incoming
    .filter((n): n is CharacterNode => n.type === "character")
    .map((n) => {
      const variant = resolveCharacterVariant(n);
      const referenceAssetIds = variant
        ? [
            ...new Set([
              ...variant.referenceAssetIds,
              ...(variant.primaryAssetId ? [variant.primaryAssetId] : []),
              ...variant.references.map((ref) => ref.assetId),
            ]),
          ].filter(Boolean)
        : [];

      return {
        nodeId: n.id,
        characterName: n.data.characterName,
        variantName: variant?.name ?? "",
        referenceAssetIds,
        referenceUrls: referenceAssetIds.map((id) => assetUrl(assets, id)),
      };
    });

  const scenes = incoming
    .filter((n): n is SceneNode => n.type === "scene")
    .map((n) => {
      const viewpointAssetIds = n.data.viewpoints
        .map((viewpoint) => viewpoint.assetId)
        .filter(Boolean);
      const primaryAssetId =
        n.data.primaryAssetId || n.data.referenceAssetIds[0] || "";

      return {
        nodeId: n.id,
        sceneName: n.data.sceneName,
        primaryAssetId,
        primaryUrl: assetUrl(assets, primaryAssetId),
        viewpointAssetIds,
        viewpointUrls: viewpointAssetIds.map((id) => assetUrl(assets, id)),
      };
    });

  const referenceImages = [
    ...incoming
      .filter((n): n is ImageNode => n.type === "image")
      .map((n) => {
        const assetIds = [
          ...new Set([
            ...n.data.assetIds,
            ...(n.data.primaryAssetId ? [n.data.primaryAssetId] : []),
          ]),
        ].filter(Boolean);

        return {
          nodeId: n.id,
          referenceType: n.data.referenceType,
          assetIds,
          urls: assetIds.map((id) => assetUrl(assets, id)),
        };
      }),
    ...incoming
      .filter((n): n is PropNode => n.type === "prop")
      .map((n) => {
        const assetIds = [
          ...new Set([
            ...n.data.assetIds,
            ...(n.data.primaryAssetId ? [n.data.primaryAssetId] : []),
          ]),
        ].filter(Boolean);

        return {
          nodeId: n.id,
          referenceType: "prop" as const,
          assetIds,
          urls: assetIds.map((id) => assetUrl(assets, id)),
        };
      }),
  ];

  const texts = incoming
    .filter((n): n is TextNode => n.type === "text")
    .map((n) => ({
      nodeId: n.id,
      textType: n.data.textType,
      content: n.data.content,
      legacyNegativePrompt: n.data.legacyNegativePrompt,
    }));

  const audios = incoming
    .filter((n): n is AudioNode => n.type === "audio")
    .map((n) => ({
      nodeId: n.id,
      audioType: n.data.audioType,
      assetId: n.data.assetId,
      url: assetUrl(assets, n.data.assetId),
    }));

  const errors: string[] = [];

  for (const character of characters) {
    if (character.referenceAssetIds.length === 0) {
      errors.push(
        `角色「${character.characterName || character.nodeId}」尚未配置参考图`,
      );
      continue;
    }
    for (let i = 0; i < character.referenceAssetIds.length; i += 1) {
      if (!character.referenceUrls[i]) {
        errors.push(
          `角色「${character.characterName || character.nodeId}」的参考图素材缺失`,
        );
        break;
      }
    }
  }

  for (const scene of scenes) {
    if (!scene.primaryAssetId || !scene.primaryUrl) {
      errors.push(`场景「${scene.sceneName || scene.nodeId}」尚未上传主参考图`);
    }
    for (let i = 0; i < scene.viewpointAssetIds.length; i += 1) {
      if (!scene.viewpointUrls[i]) {
        errors.push(
          `场景「${scene.sceneName || scene.nodeId}」的视角参考图素材缺失`,
        );
        break;
      }
    }
  }

  for (const image of referenceImages) {
    if (image.assetIds.length === 0) {
      errors.push(`图片参考节点 ${image.nodeId} 尚未上传图片`);
      continue;
    }
    if (image.urls.some((url) => !url)) {
      errors.push(`图片参考节点 ${image.nodeId} 的部分素材缺失`);
    }
  }

  for (const audio of audios) {
    if (!audio.assetId || !audio.url) {
      errors.push(`音频节点 ${audio.nodeId} 尚未上传文件`);
    }
  }

  const instruction = videoNode.data.generationInstruction.trim();
  const hasAnyInput =
    characters.length +
      scenes.length +
      referenceImages.length +
      texts.length +
      audios.length >
    0;

  if (!instruction && !hasAnyInput) {
    errors.push("请填写生成描述，或至少连接一个参考素材/文本输入");
  }

  const input: VideoGenerationInput = {
    shotId: videoNode.id,
    instruction,
    characters,
    scenes,
    referenceImages,
    texts,
    audios,
    duration: videoNode.data.duration,
    aspectRatio: videoNode.data.aspectRatio,
    resolution: videoNode.data.resolution,
    continuity: videoNode.data.continuityMode,
    model: videoNode.data.model,
    startFrameAssetId: videoNode.data.startFrameAssetId,
    endFrameAssetId: videoNode.data.endFrameAssetId,
    summary: {
      characterCount: characters.length,
      sceneCount: scenes.length,
      imageCount: referenceImages.length,
      textCount: texts.length,
      audioCount: audios.length,
    },
  };

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, input };
}
