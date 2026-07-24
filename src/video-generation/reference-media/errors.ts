import type { StructuredGenerationError } from "./types";

export function referenceSelectionRequiredError(
  eligibleCount: number,
  limit: number,
): StructuredGenerationError {
  return {
    code: "REFERENCE_SELECTION_REQUIRED",
    field: "selectedReferenceAssetIds",
    message: `当前有 ${eligibleCount} 项参考素材，当前模型最多支持 ${limit} 项，请先手动选择要发送的素材。`,
  };
}

export function invalidReferenceSelectionError(): StructuredGenerationError {
  return {
    code: "INVALID_REFERENCE_SELECTION",
    field: "selectedReferenceAssetIds",
    message: "参考素材选择已经失效，请重新选择。",
  };
}

export function referenceMediaLimitExceededError(
  limit: number,
): StructuredGenerationError {
  return {
    code: "REFERENCE_MEDIA_LIMIT_EXCEEDED",
    field: "selectedReferenceAssetIds",
    message: `当前模型最多支持 ${limit} 项参考素材。`,
  };
}

export function referenceMediaNotAvailableError(): StructuredGenerationError {
  return {
    code: "REFERENCE_MEDIA_NOT_AVAILABLE",
    field: "selectedReferenceAssetIds",
    message: "已选择的部分参考素材不可用，请重新选择。",
  };
}

export function staleReferenceSelectionError(): StructuredGenerationError {
  return {
    code: "STALE_REFERENCE_SELECTION",
    field: "selectedReferenceAssetIds",
    message: "参考素材选择与已保存工作流不一致，请重新打开确认后再提交。",
  };
}

export function tooManyFirstFramesError(
  limit: number,
): StructuredGenerationError {
  return {
    code: "TOO_MANY_FIRST_FRAMES",
    field: "firstFrame",
    message: `首帧最多可以选择 ${limit} 个`,
  };
}

export function firstFrameInSelectionError(): StructuredGenerationError {
  return {
    code: "INVALID_REFERENCE_SELECTION",
    field: "selectedReferenceAssetIds",
    message: "首帧素材不能同时出现在普通参考素材选择中，请重新选择。",
  };
}
