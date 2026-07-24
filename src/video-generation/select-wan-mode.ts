import type {
  GenerationAssetReference,
  InputSummary,
  VideoGenerationInput,
  WanGenerationMode,
} from "./types";

function hasUsableMedia(refs: GenerationAssetReference[]): boolean {
  return refs.some((r) => Boolean(r.assetId));
}

/**
 * 服务端模式选择：禁止由前端任意指定绕过。
 * 有参考图 / 参考视频 / 首帧 → referenceToVideo，否则 textToVideo。
 */
export function selectWanGenerationMode(
  input: Pick<
    VideoGenerationInput,
    | "characterReferences"
    | "sceneReferences"
    | "imageReferences"
    | "referenceVideos"
    | "firstFrame"
  >,
): WanGenerationMode {
  if (input.firstFrame?.assetId) return "referenceToVideo";
  if (hasUsableMedia(input.referenceVideos)) return "referenceToVideo";
  if (hasUsableMedia(input.characterReferences)) return "referenceToVideo";
  if (hasUsableMedia(input.sceneReferences)) return "referenceToVideo";
  if (hasUsableMedia(input.imageReferences)) return "referenceToVideo";
  return "textToVideo";
}

export function buildInputSummary(
  input: VideoGenerationInput,
  unsupportedAudioLabels: string[] = [],
): InputSummary {
  const images = [
    ...input.characterReferences,
    ...input.sceneReferences,
    ...input.imageReferences,
  ];
  return {
    hasReferenceImages: images.length > 0,
    hasReferenceVideos: input.referenceVideos.length > 0,
    hasFirstFrame: Boolean(input.firstFrame?.assetId),
    referenceImageCount: images.length,
    referenceVideoCount: input.referenceVideos.length,
    firstFrameCount: input.firstFrame?.assetId ? 1 : 0,
    unsupportedAudioLabels,
  };
}
