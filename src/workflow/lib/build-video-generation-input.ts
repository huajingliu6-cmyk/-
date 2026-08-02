import { HANDLES } from "../connection-rules";
import {
  isVideoAspectRatio,
  isVideoResolution,
} from "@/video-generation/dimensions";
import {
  collectReferenceMediaCandidates,
  resolveFirstFrame,
  resolveReferenceMediaSelection,
  type ReferenceMediaCandidate,
  type ReferenceSelectionMode,
  type StructuredGenerationError,
} from "@/video-generation/reference-media";
import type { ModelCapability } from "@/video-generation/types";
import type {
  DirectorSettings,
  GenerationAssetReference,
  VideoAspectRatio,
  VideoGenerationInput,
  VideoResolution,
} from "@/video-generation/types";
import type {
  AudioNode,
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
      candidates: ReferenceMediaCandidate[];
      requiresManualSelection: boolean;
    }
  | {
      ok: false;
      errors: string[];
      structuredErrors: StructuredGenerationError[];
      candidates: ReferenceMediaCandidate[];
      requiresManualSelection: boolean;
    };

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

function normalizeResolution(raw: string): VideoResolution {
  if (isVideoResolution(raw)) return raw;
  if (raw.includes("1080")) return "1080P";
  if (raw.includes("480")) return "480P";
  return "720P";
}

function normalizeAspect(raw: string): VideoAspectRatio {
  if (isVideoAspectRatio(raw)) return raw;
  return "9:16";
}

function candidateToReference(
  c: ReferenceMediaCandidate,
): GenerationAssetReference {
  const kind =
    c.referenceKind === "character"
      ? "character"
      : c.referenceKind === "scene"
        ? "scene"
        : c.referenceKind === "referenceVideo"
          ? "reference_video"
          : "image";
  return {
    assetId: c.assetId,
    kind,
    label: c.label,
    mimeType: c.mimeType,
    sourceUrl: c.url || "",
  };
}

export type BuildVideoGenerationInputOptions = {
  /**
   * 客户端可选快照；若提供则必须与节点上保存的数组与顺序完全一致，
   * 否则返回 STALE_REFERENCE_SELECTION。权威来源始终是 WorkflowDocument。
   */
  clientSelectedReferenceAssetIds?: string[];
  /**
   * 模型能力（权威）。未提供时不得用硬编码上限冒充业务限制，
   * 必须返回 MODEL_CAPABILITY_NOT_LOADED。
   */
  capability?: Pick<
    ModelCapability,
    | "maxReferenceMedia"
    | "maxFirstFrames"
    | "supportsReferenceImages"
    | "supportsReferenceVideos"
    | "supportsFirstFrame"
  >;
};

function arraysEqualOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 纯函数：汇总连接到指定 VideoShotNode 的最终生成输入。
 * 链路：候选收集 → 首帧 → 选择解析 → 有序 input。
 */
export function buildVideoGenerationInput(
  document: WorkflowDocument,
  videoShotNodeId: string,
  options?: BuildVideoGenerationInputOptions,
): BuildVideoGenerationInputResult {
  const videoNode = document.nodes.find(
    (n): n is VideoShotNode =>
      n.id === videoShotNodeId && n.type === "videoShot",
  );

  if (!videoNode) {
    return {
      ok: false,
      errors: ["未找到镜头节点"],
      structuredErrors: [
        {
          code: "SHOT_NOT_FOUND",
          message: "未找到镜头节点",
        },
      ],
      candidates: [],
      requiresManualSelection: false,
    };
  }

  if (!options?.capability) {
    return {
      ok: false,
      errors: ["模型能力尚未加载"],
      structuredErrors: [
        {
          code: "MODEL_CAPABILITY_NOT_LOADED",
          field: "capability",
          message: "模型能力尚未加载",
        },
      ],
      candidates: [],
      requiresManualSelection: false,
    };
  }

  const capability = options.capability;
  const selectionMode: ReferenceSelectionMode =
    videoNode.data.referenceSelectionMode === "manual" ? "manual" : "auto";
  const nodeSelectedIds = videoNode.data.selectedReferenceAssetIds ?? [];

  if (
    options?.clientSelectedReferenceAssetIds !== undefined &&
    !arraysEqualOrder(
      options.clientSelectedReferenceAssetIds,
      nodeSelectedIds,
    )
  ) {
    return {
      ok: false,
      errors: ["参考素材选择与已保存工作流不一致，请重新打开确认后再提交。"],
      structuredErrors: [
        {
          code: "STALE_REFERENCE_SELECTION",
          field: "selectedReferenceAssetIds",
          message:
            "参考素材选择与已保存工作流不一致，请重新打开确认后再提交。",
        },
      ],
      candidates: [],
      requiresManualSelection: false,
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
  if (!firstFrameResult.ok) {
    return {
      ok: false,
      errors: firstFrameResult.errors.map((e) => e.message),
      structuredErrors: firstFrameResult.errors,
      candidates,
      requiresManualSelection: false,
    };
  }

  const firstFrameCandidate = firstFrameResult.firstFrame;
  const selection = resolveReferenceMediaSelection({
    candidates,
    selectionMode,
    selectedReferenceAssetIds: nodeSelectedIds,
    capability,
    firstFrameAssetId: firstFrameCandidate?.assetId ?? null,
  });

  if (selection.requiresManualSelection || selection.validationErrors.length > 0) {
    return {
      ok: false,
      errors: selection.validationErrors.map((e) => e.message),
      structuredErrors: selection.validationErrors,
      candidates,
      requiresManualSelection: selection.requiresManualSelection,
    };
  }

  const incoming = incomingSources(document, videoShotNodeId);
  const unsupportedAudioLabels: string[] = [];
  for (const n of incoming.filter(
    (node): node is AudioNode => node.type === "audio",
  )) {
    if (n.data.audioType === "voice") {
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
    return {
      ok: false,
      errors: ["请填写生成描述，或连接文本节点"],
      structuredErrors: [
        {
          code: "PROMPT_REQUIRED",
          field: "prompt",
          message: "请填写生成描述，或连接文本节点",
        },
      ],
      candidates,
      requiresManualSelection: false,
    };
  }

  const orderedReferenceMedia = selection.selected.map(candidateToReference);
  const characterReferences = orderedReferenceMedia.filter(
    (r) => r.kind === "character",
  );
  const sceneReferences = orderedReferenceMedia.filter(
    (r) => r.kind === "scene",
  );
  const imageReferences = orderedReferenceMedia.filter(
    (r) => r.kind === "image",
  );
  const referenceVideos = orderedReferenceMedia.filter(
    (r) => r.kind === "reference_video",
  );

  let firstFrame: GenerationAssetReference | undefined;
  if (firstFrameCandidate) {
    firstFrame = {
      assetId: firstFrameCandidate.assetId,
      kind: "first_frame",
      label: firstFrameCandidate.label,
      mimeType: firstFrameCandidate.mimeType,
      sourceUrl: firstFrameCandidate.url || "",
    };
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
    imageReferences,
    referenceVideos,
    orderedReferenceMedia,
    firstFrame,
    directorSettings,
    textInputs,
    referenceSelectionMode: selectionMode,
    selectedReferenceAssetIds: selection.selected.map((c) => c.assetId),
    requiresManualSelection: false,
  };

  return {
    ok: true,
    input,
    unsupportedAudioLabels,
    candidates,
    requiresManualSelection: false,
  };
}
