import { selectWanGenerationMode } from "../select-wan-mode";
import type { VideoGenerationInput } from "../types";
import { LOCAL_PAID_TEST_SPEC } from "./constants";
import { LocalPaidTestError } from "./errors";

export type LocalPaidTestSpecViolation = {
  field: string;
  message: string;
};

/**
 * 服务端强制最低规格：纯 T2V / 720P / 16:9 / 2s / 无任何参考素材。
 * 不修改 ModelCapability；仅闸门使用。
 */
export function collectLocalPaidTestSpecViolations(
  input: VideoGenerationInput,
): LocalPaidTestSpecViolation[] {
  const violations: LocalPaidTestSpecViolation[] = [];
  const mode = selectWanGenerationMode(input);

  if (mode !== LOCAL_PAID_TEST_SPEC.mode) {
    violations.push({ field: "mode", message: "仅允许 textToVideo" });
  }
  if (input.resolution !== LOCAL_PAID_TEST_SPEC.resolution) {
    violations.push({ field: "resolution", message: "仅允许 720P" });
  }
  if (input.aspectRatio !== LOCAL_PAID_TEST_SPEC.aspectRatio) {
    violations.push({ field: "aspectRatio", message: "仅允许 16:9" });
  }
  if (input.durationSeconds !== LOCAL_PAID_TEST_SPEC.durationSeconds) {
    violations.push({ field: "durationSeconds", message: "仅允许 2 秒" });
  }
  if (input.firstFrame) {
    violations.push({ field: "firstFrame", message: "不允许首帧" });
  }
  if (input.characterReferences.length > 0) {
    violations.push({ field: "characterReferences", message: "不允许角色参考" });
  }
  if (input.sceneReferences.length > 0) {
    violations.push({ field: "sceneReferences", message: "不允许场景参考" });
  }
  if (input.imageReferences.length > 0) {
    violations.push({ field: "imageReferences", message: "不允许普通参考图" });
  }
  if (input.referenceVideos.length > 0) {
    violations.push({ field: "referenceVideos", message: "不允许参考视频" });
  }
  if (input.orderedReferenceMedia.length > 0) {
    violations.push({
      field: "orderedReferenceMedia",
      message: "不允许参考素材",
    });
  }
  if (input.selectedReferenceAssetIds.length > 0) {
    violations.push({
      field: "selectedReferenceAssetIds",
      message: "不允许已选参考素材",
    });
  }

  const hasVoice = [
    ...input.characterReferences,
    ...input.sceneReferences,
    ...input.imageReferences,
    ...input.referenceVideos,
    ...(input.firstFrame ? [input.firstFrame] : []),
    ...input.orderedReferenceMedia,
  ].some((m) => Boolean(m.referenceVoiceAssetId));
  if (hasVoice) {
    violations.push({ field: "referenceVoice", message: "不允许音色参考" });
  }

  return violations;
}

export function assertLocalPaidTestSpec(input: VideoGenerationInput): void {
  const violations = collectLocalPaidTestSpecViolations(input);
  if (violations.length > 0) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_SPEC_NOT_ALLOWED");
  }
}
