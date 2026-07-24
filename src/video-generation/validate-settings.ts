import { isVideoAspectRatio, isVideoResolution } from "./dimensions";
import type {
  InputSummary,
  ModelCapability,
  NormalizedGenerationSettings,
  ValidationError,
} from "./types";

export type ValidateGenerationSettingsArgs = {
  capability: ModelCapability;
  settings: NormalizedGenerationSettings;
  inputSummary: InputSummary;
};

export function validateGenerationSettings(
  args: ValidateGenerationSettingsArgs,
): ValidationError[] {
  const { capability, settings, inputSummary } = args;
  const errors: ValidationError[] = [];

  if (!isVideoResolution(settings.resolution)) {
    errors.push({
      code: "UNSUPPORTED_RESOLUTION",
      field: "resolution",
      message: "当前模型不支持该分辨率",
    });
  } else if (!capability.supportedResolutions.includes(settings.resolution)) {
    errors.push({
      code: "UNSUPPORTED_RESOLUTION",
      field: "resolution",
      message: "当前模型不支持该分辨率",
    });
  }

  const hasFirstFrame = inputSummary.hasFirstFrame;
  if (hasFirstFrame) {
    if (settings.aspectRatio !== null) {
      errors.push({
        code: "RATIO_IGNORED_WITH_FIRST_FRAME",
        field: "aspectRatio",
        message: "已连接首帧，画面比例将由首帧决定",
      });
    }
  } else if (settings.aspectRatio === null) {
    errors.push({
      code: "ASPECT_RATIO_REQUIRED",
      field: "aspectRatio",
      message: "请选择画面比例",
    });
  } else if (!isVideoAspectRatio(settings.aspectRatio)) {
    errors.push({
      code: "UNSUPPORTED_ASPECT_RATIO",
      field: "aspectRatio",
      message: "当前模型不支持该画面比例",
    });
  } else if (!capability.supportedAspectRatios.includes(settings.aspectRatio)) {
    errors.push({
      code: "UNSUPPORTED_ASPECT_RATIO",
      field: "aspectRatio",
      message: "当前模型不支持该画面比例",
    });
  }

  const duration = settings.durationSeconds;
  if (!Number.isInteger(duration)) {
    errors.push({
      code: "DURATION_NOT_INTEGER",
      field: "durationSeconds",
      message: "视频时长必须为整数秒",
    });
  }

  const maxDuration = inputSummary.hasReferenceVideos
    ? capability.maxDurationWithReferenceVideoSeconds
    : capability.maxDurationSeconds;
  const minDuration = capability.minDurationSeconds;

  if (
    Number.isInteger(duration) &&
    (duration < minDuration || duration > maxDuration)
  ) {
    if (inputSummary.hasReferenceVideos && duration > maxDuration) {
      errors.push({
        code: "DURATION_EXCEEDS_WITH_REFERENCE_VIDEO",
        field: "durationSeconds",
        message: `当前包含参考视频，最大生成时长为 ${maxDuration} 秒`,
      });
    } else {
      errors.push({
        code: "DURATION_OUT_OF_RANGE",
        field: "durationSeconds",
        message: `视频时长必须为 ${minDuration} 到 ${maxDuration} 秒之间的整数`,
      });
    }
  }

  if (capability.mode === "referenceToVideo") {
    const mediaCount =
      inputSummary.referenceImageCount + inputSummary.referenceVideoCount;
    if (mediaCount < 1 && !inputSummary.hasFirstFrame) {
      // first_frame alone: docs say need at least one reference_image or reference_video
      // "参考图像和参考视频至少传入1个"
      errors.push({
        code: "REFERENCE_MEDIA_REQUIRED",
        field: "media",
        message: "参考生视频至少需要一张参考图片或一个参考视频",
      });
    }
    // If only first_frame without ref image/video - also invalid per docs
    if (
      inputSummary.hasFirstFrame &&
      inputSummary.referenceImageCount + inputSummary.referenceVideoCount < 1
    ) {
      errors.push({
        code: "REFERENCE_MEDIA_REQUIRED",
        field: "media",
        message: "参考生视频至少需要一张参考图片或一个参考视频",
      });
    }
    if (mediaCount > capability.maxReferenceMedia) {
      errors.push({
        code: "TOO_MANY_REFERENCE_MEDIA",
        field: "media",
        message: `当前有 ${mediaCount} 项参考素材，当前模型最多支持 ${capability.maxReferenceMedia} 项。`,
      });
    }
    if (inputSummary.firstFrameCount > capability.maxFirstFrames) {
      errors.push({
        code: "TOO_MANY_FIRST_FRAMES",
        field: "firstFrame",
        message: `首帧最多可以选择 ${capability.maxFirstFrames} 个`,
      });
    }
  } else {
    // textToVideo must not rely on refs (mode selection handles this)
    if (
      inputSummary.hasReferenceImages ||
      inputSummary.hasReferenceVideos ||
      inputSummary.hasFirstFrame
    ) {
      errors.push({
        code: "MODE_MISMATCH",
        field: "mode",
        message: "当前输入包含参考素材，应使用参考生视频模式",
      });
    }
  }

  return errors;
}

/** 前端：有参考视频且时长 >10 时给出不兼容提示（不静默改值） */
export function getDurationCompatibilityWarning(
  durationSeconds: number,
  hasReferenceVideo: boolean,
  maxWithVideo: number,
): string | null {
  if (!hasReferenceVideo) return null;
  if (durationSeconds <= maxWithVideo) return null;
  return `当前时长为 ${durationSeconds} 秒，连接参考视频后最大仅支持 ${maxWithVideo} 秒。请确认后改为 ${maxWithVideo} 秒再生成。`;
}
