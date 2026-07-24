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
 * 基于最终选定素材 + 首帧，而非全量连接候选。
 */
export function selectWanGenerationMode(
  input: Pick<
    VideoGenerationInput,
    | "orderedReferenceMedia"
    | "characterReferences"
    | "sceneReferences"
    | "imageReferences"
    | "referenceVideos"
    | "firstFrame"
  >,
): WanGenerationMode {
  if (input.firstFrame?.assetId) return "referenceToVideo";
  const ordered = input.orderedReferenceMedia;
  if (ordered && ordered.length > 0) {
    if (hasUsableMedia(ordered)) return "referenceToVideo";
    return "textToVideo";
  }
  // 兼容旧调用：无 ordered 字段时回退
  if (hasUsableMedia(input.referenceVideos ?? [])) return "referenceToVideo";
  if (hasUsableMedia(input.characterReferences ?? [])) return "referenceToVideo";
  if (hasUsableMedia(input.sceneReferences ?? [])) return "referenceToVideo";
  if (hasUsableMedia(input.imageReferences ?? [])) return "referenceToVideo";
  return "textToVideo";
}

/**
 * 摘要计数必须基于最终 selected（orderedReferenceMedia），而非全量候选。
 */
export function buildInputSummary(
  input: VideoGenerationInput,
  unsupportedAudioLabels: string[] = [],
): InputSummary {
  const ordered =
    input.orderedReferenceMedia ??
    [
      ...input.characterReferences,
      ...input.sceneReferences,
      ...input.imageReferences,
      ...input.referenceVideos,
    ];
  const images = ordered.filter((r) => r.kind !== "reference_video");
  const videos = ordered.filter((r) => r.kind === "reference_video");
  return {
    hasReferenceImages: images.length > 0,
    hasReferenceVideos: videos.length > 0,
    hasFirstFrame: Boolean(input.firstFrame?.assetId),
    referenceImageCount: images.length,
    referenceVideoCount: videos.length,
    firstFrameCount: input.firstFrame?.assetId ? 1 : 0,
    unsupportedAudioLabels,
  };
}
