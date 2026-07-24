import {
  collectReferenceMediaCandidates,
  resolveFirstFrame,
  resolveReferenceMediaSelection,
  type ReferenceMediaCandidate,
  type ReferenceSelectionMode,
  type ResolvedReferenceMediaSelection,
  type FirstFrameResolution,
} from "@/video-generation/reference-media";
import type { ModelCapability } from "@/video-generation/types";
import type { WorkflowDocument } from "@/workflow/types";
import {
  buildReferenceMediaSelectionView,
  type ReferenceMediaSelectionView,
} from "@/workflow/lib/reference-media-selection-view";

export type ReferenceMediaSelectionBundle = {
  candidates: ReferenceMediaCandidate[];
  firstFrameResult: FirstFrameResolution;
  resolved: ResolvedReferenceMediaSelection | null;
  view: ReferenceMediaSelectionView;
};

/**
 * 复用 3C-A 领域函数组装 UI bundle；capability 缺失时不伪造上限。
 */
export function prepareReferenceMediaSelectionBundle(params: {
  document: WorkflowDocument;
  videoShotNodeId: string;
  capability: Pick<
    ModelCapability,
    | "maxReferenceMedia"
    | "maxFirstFrames"
    | "supportsReferenceImages"
    | "supportsReferenceVideos"
    | "supportsFirstFrame"
  > | null;
  mode: ReferenceSelectionMode;
  selectedReferenceAssetIds: string[];
}): ReferenceMediaSelectionBundle {
  const { document, videoShotNodeId, capability, mode } = params;

  if (!capability) {
    const candidates = collectReferenceMediaCandidates({
      document,
      videoShotNodeId,
      capability: {
        maxReferenceMedia: 0,
        supportsReferenceImages: true,
        supportsReferenceVideos: true,
      },
    });
    const firstFrameResult = resolveFirstFrame({
      document,
      videoShotNodeId,
      capability: {
        maxFirstFrames: 1,
        supportsFirstFrame: true,
      },
    });

    return {
      candidates,
      firstFrameResult,
      resolved: null,
      view: buildReferenceMediaSelectionView({
        candidates,
        resolvedSelection: null,
        firstFrame: firstFrameResult,
        capability: null,
        currentMode: mode,
      }),
    };
  }

  const candidates = collectReferenceMediaCandidates({
    document,
    videoShotNodeId,
    capability,
  });
  const firstFrameResult = resolveFirstFrame({
    document,
    videoShotNodeId,
    capability,
  });
  const firstFrameAssetId =
    firstFrameResult.ok && firstFrameResult.firstFrame
      ? firstFrameResult.firstFrame.assetId
      : null;

  const resolved = resolveReferenceMediaSelection({
    candidates,
    selectionMode: mode,
    selectedReferenceAssetIds: params.selectedReferenceAssetIds,
    capability,
    firstFrameAssetId,
  });

  return {
    candidates,
    firstFrameResult,
    resolved,
    view: buildReferenceMediaSelectionView({
      candidates,
      resolvedSelection: resolved,
      firstFrame: firstFrameResult,
      capability,
      currentMode: mode,
    }),
  };
}
