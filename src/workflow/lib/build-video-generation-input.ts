import { HANDLES } from "../connection-rules";
import {
  isVideoAspectRatio,
  isVideoResolution,
} from "@/video-generation/dimensions";
import type {
  DirectorSettings,
  GenerationAssetReference,
  VideoAspectRatio,
  VideoGenerationInput,
  VideoResolution,
} from "@/video-generation/types";
import type {
  AssetRecord,
  AudioNode,
  CharacterNode,
  ImageNode,
  PropNode,
  SceneNode,
  TextNode,
  VideoShotNode,
  WorkflowDocument,
  WorkflowNode,
} from "../types";

export type BuildVideoGenerationInputResult =
  | {
      ok: true;
      input: VideoGenerationInput;
      unsupportedAudioLabels: string[];
    }
  | { ok: false; errors: string[] };

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

function resolveCharacterVariant(node: CharacterNode) {
  return (
    node.data.variants.find(
      (variant) => variant.id === node.data.selectedVariantId,
    ) ??
    node.data.variants.find(
      (variant) => variant.id === node.data.primaryVariantId,
    ) ??
    node.data.variants[0] ??
    null
  );
}

function normalizeResolution(raw: string): VideoResolution {
  if (isVideoResolution(raw)) return raw;
  if (raw.includes("1080")) return "1080P";
  return "720P";
}

function normalizeAspect(raw: string): VideoAspectRatio {
  if (isVideoAspectRatio(raw)) return raw;
  return "9:16";
}

/**
 * 纯函数：汇总连接到指定 VideoShotNode 的全部输入。
 * Mock 与真实 Provider 的共同输入来源。
 */
export function buildVideoGenerationInput(
  document: WorkflowDocument,
  videoShotNodeId: string,
  options?: { selectedReferenceAssetIds?: string[] },
): BuildVideoGenerationInputResult {
  const videoNode = document.nodes.find(
    (n): n is VideoShotNode =>
      n.id === videoShotNodeId && n.type === "videoShot",
  );

  if (!videoNode) {
    return { ok: false, errors: ["未找到镜头节点"] };
  }

  const { assets } = document;
  const incoming = incomingSources(document, videoShotNodeId);
  const errors: string[] = [];
  const unsupportedAudioLabels: string[] = [];

  const characterReferences: GenerationAssetReference[] = [];
  for (const n of incoming.filter(
    (node): node is CharacterNode => node.type === "character",
  )) {
    const variant = resolveCharacterVariant(n);
    const primaryId = variant?.primaryAssetId || "";
    const asset = assetById(assets, primaryId);
    if (!primaryId || !asset) {
      errors.push(
        `角色「${n.data.characterName || n.id}」尚未配置主参考图`,
      );
      continue;
    }
    if (asset.url.startsWith("blob:")) {
      errors.push(
        `角色「${n.data.characterName || n.id}」素材为临时地址，无法用于生成`,
      );
      continue;
    }
    const voiceId =
      variant && "referenceVoiceAssetId" in variant
        ? String(
            (variant as { referenceVoiceAssetId?: string })
              .referenceVoiceAssetId ?? "",
          )
        : n.data.voiceAssetId || "";
    characterReferences.push({
      assetId: asset.id,
      kind: "character",
      label: n.data.characterName || variant?.name || "角色",
      mimeType: asset.mimeType,
      sourceUrl: asset.url,
      referenceVoiceAssetId: voiceId || undefined,
    });
  }

  const sceneReferences: GenerationAssetReference[] = [];
  for (const n of incoming.filter(
    (node): node is SceneNode => node.type === "scene",
  )) {
    const primaryId =
      n.data.primaryAssetId || n.data.referenceAssetIds[0] || "";
    const asset = assetById(assets, primaryId);
    if (!primaryId || !asset) {
      errors.push(`场景「${n.data.sceneName || n.id}」尚未上传主参考图`);
      continue;
    }
    if (asset.url.startsWith("blob:")) {
      errors.push(`场景「${n.data.sceneName || n.id}」素材为临时地址`);
      continue;
    }
    sceneReferences.push({
      assetId: asset.id,
      kind: "scene",
      label: n.data.sceneName || "场景",
      mimeType: asset.mimeType,
      sourceUrl: asset.url,
    });
  }

  const imageReferences: GenerationAssetReference[] = [];
  for (const n of incoming.filter(
    (node): node is ImageNode => node.type === "image",
  )) {
    const selectedIds =
      (n.data as { selectedAssetIds?: string[] }).selectedAssetIds?.length
        ? (n.data as { selectedAssetIds: string[] }).selectedAssetIds
        : [
            ...new Set([
              ...(n.data.primaryAssetId ? [n.data.primaryAssetId] : []),
              ...n.data.assetIds,
            ]),
          ].filter(Boolean);

    if (n.data.referenceType === "startFrame") {
      // handled as first frame below
      const id = selectedIds[0] || "";
      const asset = assetById(assets, id);
      if (asset && !asset.url.startsWith("blob:")) {
        // collect later into firstFrame — keep one
        imageReferences.push({
          assetId: asset.id,
          kind: "first_frame",
          label: n.data.title || "首帧",
          mimeType: asset.mimeType,
          sourceUrl: asset.url,
        });
      } else {
        errors.push(`图片节点 ${n.id} 的首帧素材缺失或不可用`);
      }
      continue;
    }

    for (const id of selectedIds) {
      const asset = assetById(assets, id);
      if (!asset) {
        errors.push(`图片参考节点 ${n.id} 的素材缺失`);
        continue;
      }
      if (asset.url.startsWith("blob:")) {
        errors.push(`图片参考节点 ${n.id} 含临时地址，无法用于生成`);
        continue;
      }
      imageReferences.push({
        assetId: asset.id,
        kind: "image",
        label: n.data.title || "参考图",
        mimeType: asset.mimeType,
        sourceUrl: asset.url,
      });
    }
  }

  for (const n of incoming.filter(
    (node): node is PropNode => node.type === "prop",
  )) {
    const ids = [
      ...new Set([
        ...(n.data.primaryAssetId ? [n.data.primaryAssetId] : []),
        ...n.data.assetIds,
      ]),
    ].filter(Boolean);
    for (const id of ids) {
      const asset = assetById(assets, id);
      if (!asset || asset.url.startsWith("blob:")) {
        errors.push(`道具节点 ${n.id} 的素材缺失或不可用`);
        continue;
      }
      imageReferences.push({
        assetId: asset.id,
        kind: "image",
        label: n.data.propName || "道具",
        mimeType: asset.mimeType,
        sourceUrl: asset.url,
      });
    }
  }

  const referenceVideos: GenerationAssetReference[] = [];
  // 视频参考：挂在 videoShot 的 sourceVideoAssetId，或 continuity
  if (videoNode.data.sourceVideoAssetId) {
    const asset = assetById(assets, videoNode.data.sourceVideoAssetId);
    if (asset) {
      referenceVideos.push({
        assetId: asset.id,
        kind: "reference_video",
        label: asset.name || "参考视频",
        mimeType: asset.mimeType,
        sourceUrl: asset.url,
      });
    }
  }

  let firstFrame: GenerationAssetReference | undefined;
  if (videoNode.data.startFrameAssetId) {
    const asset = assetById(assets, videoNode.data.startFrameAssetId);
    if (asset && !asset.url.startsWith("blob:")) {
      firstFrame = {
        assetId: asset.id,
        kind: "first_frame",
        label: "首帧",
        mimeType: asset.mimeType,
        sourceUrl: asset.url,
      };
    }
  }
  const fromImageNode = imageReferences.find((r) => r.kind === "first_frame");
  if (!firstFrame && fromImageNode) {
    firstFrame = fromImageNode;
  }
  const plainImages = imageReferences.filter((r) => r.kind !== "first_frame");

  for (const n of incoming.filter(
    (node): node is AudioNode => node.type === "audio",
  )) {
    if (n.data.audioType === "voice") {
      // 仅当明确绑到角色时才作为 reference_voice；否则标记不支持发送为 BGM
      unsupportedAudioLabels.push(
        `${n.data.title || "音频"}（voice，未绑定角色则不作为 reference_voice）`,
      );
    } else {
      unsupportedAudioLabels.push(
        `${n.data.title || n.data.audioType}（当前模型不支持作为参考音色）`,
      );
    }
  }

  const textInputs = incoming
    .filter((node): node is TextNode => node.type === "text")
    .map((n) => n.data.content.trim())
    .filter(Boolean);

  const instruction = videoNode.data.generationInstruction.trim();
  if (!instruction && textInputs.length === 0) {
    errors.push("请填写生成描述，或连接文本节点");
  }

  const hasFirstFrame = Boolean(firstFrame);
  const resolution = normalizeResolution(videoNode.data.resolution);
  const aspectRatio = hasFirstFrame
    ? null
    : normalizeAspect(videoNode.data.aspectRatio);

  const directorSettings: DirectorSettings = {
    shotSize: videoNode.data.shotSize,
    cameraAngle: videoNode.data.cameraAngle,
    cameraMovement: videoNode.data.cameraMovement,
    colorTone: videoNode.data.colorTone,
    focalLength: videoNode.data.focalLength,
    actionDescription: videoNode.data.actionDescription,
    stylePreset: videoNode.data.stylePreset,
  };

  const input: VideoGenerationInput = {
    shotId: videoNode.id,
    projectId: document.projectId,
    prompt: instruction || textInputs.join("\n"),
    resolution,
    aspectRatio,
    durationSeconds: videoNode.data.duration,
    watermark: false,
    promptExtend: true,
    characterReferences,
    sceneReferences,
    imageReferences: plainImages,
    referenceVideos,
    firstFrame,
    directorSettings,
    textInputs,
    selectedReferenceAssetIds: options?.selectedReferenceAssetIds,
  };

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, input, unsupportedAudioLabels };
}
