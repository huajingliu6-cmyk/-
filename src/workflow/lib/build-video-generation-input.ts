import { HANDLES } from "../connection-rules";
import type {
  AudioReferenceNode,
  CharacterReferenceNode,
  DirectorNode,
  ImageReferenceNode,
  TextNode,
  SceneReferenceNode,
  VideoGenerationInput,
  VideoGenerationInputResult,
  VideoGeneratorNode,
  WorkflowDocument,
  WorkflowNode,
} from "../types";

function incomingSources(
  document: WorkflowDocument,
  videoNodeId: string,
  targetHandle: string,
): WorkflowNode[] {
  return document.edges
    .filter(
      (edge) =>
        edge.target === videoNodeId && edge.targetHandle === targetHandle,
    )
    .map((edge) => document.nodes.find((n) => n.id === edge.source))
    .filter((n): n is WorkflowNode => Boolean(n));
}

/**
 * 纯函数：汇总连接到指定 VideoGeneratorNode 的全部输入。
 */
export function buildVideoGenerationInput(
  workflow: WorkflowDocument,
  videoNodeId: string,
): VideoGenerationInputResult {
  const videoNode = workflow.nodes.find(
    (n): n is VideoGeneratorNode =>
      n.id === videoNodeId && n.type === "videoGenerator",
  );

  if (!videoNode) {
    return { ok: false, errors: ["未找到视频生成节点"] };
  }

  const characters = incomingSources(
    workflow,
    videoNodeId,
    HANDLES.characterInput,
  )
    .filter((n): n is CharacterReferenceNode => n.type === "character")
    .map((n) => ({
      nodeId: n.id,
      characterName: n.data.characterName,
      assetId: n.data.assetId,
      assetUrl: n.data.assetUrl,
    }));

  const scenes = incomingSources(workflow, videoNodeId, HANDLES.sceneInput)
    .filter((n): n is SceneReferenceNode => n.type === "scene")
    .map((n) => ({
      nodeId: n.id,
      sceneName: n.data.sceneName,
      assetId: n.data.assetId,
      assetUrl: n.data.assetUrl,
    }));

  const images = incomingSources(workflow, videoNodeId, HANDLES.imageInput)
    .filter((n): n is ImageReferenceNode => n.type === "image")
    .map((n) => ({
      nodeId: n.id,
      referenceType: n.data.referenceType,
      assetId: n.data.assetId,
      assetUrl: n.data.assetUrl,
    }));

  const texts = incomingSources(workflow, videoNodeId, HANDLES.textInput)
    .filter((n): n is TextNode => n.type === "text")
    .map((n) => ({
      nodeId: n.id,
      textType: n.data.textType,
      content: n.data.content,
      legacyNegativePrompt: n.data.legacyNegativePrompt,
    }));

  const audios = incomingSources(workflow, videoNodeId, HANDLES.audioInput)
    .filter((n): n is AudioReferenceNode => n.type === "audio")
    .map((n) => ({
      nodeId: n.id,
      assetId: n.data.assetId,
      assetUrl: n.data.assetUrl,
      fileName: n.data.fileName,
    }));

  const directorNode = incomingSources(
    workflow,
    videoNodeId,
    HANDLES.directorInput,
  ).find((n): n is DirectorNode => n.type === "director");

  const director = directorNode
    ? {
        nodeId: directorNode.id,
        shotSize: directorNode.data.shotSize,
        cameraAngle: directorNode.data.cameraAngle,
        cameraMovement: directorNode.data.cameraMovement,
        lens: directorNode.data.lens,
        movementSpeed: directorNode.data.movementSpeed,
        description: directorNode.data.description,
      }
    : null;

  const errors: string[] = [];

  for (const c of characters) {
    if (!c.assetUrl || !c.assetId) {
      errors.push(`角色「${c.characterName || c.nodeId}」尚未上传参考图`);
    }
  }
  for (const s of scenes) {
    if (!s.assetUrl || !s.assetId) {
      errors.push(`场景「${s.sceneName || s.nodeId}」尚未上传参考图`);
    }
  }
  for (const img of images) {
    if (!img.assetUrl || !img.assetId) {
      errors.push(`图片参考节点 ${img.nodeId} 尚未上传图片`);
    }
  }
  for (const audio of audios) {
    if (!audio.assetUrl || !audio.assetId) {
      errors.push(`音频节点 ${audio.nodeId} 尚未上传文件`);
    }
  }

  const instruction = videoNode.data.generationInstruction.trim();
  const hasAnyInput =
    characters.length +
      scenes.length +
      images.length +
      texts.length +
      audios.length +
      (director ? 1 : 0) >
    0;

  if (!instruction && !hasAnyInput) {
    errors.push("请填写生成描述，或至少连接一个素材/导演/文本输入");
  }

  const input: VideoGenerationInput = {
    videoNodeId,
    generationInstruction: instruction,
    characters,
    scenes,
    images,
    texts,
    audios,
    director,
    summary: {
      characterCount: characters.length,
      sceneCount: scenes.length,
      imageCount: images.length,
      textCount: texts.length,
      audioCount: audios.length,
      hasDirector: Boolean(director),
    },
  };

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, input };
}
