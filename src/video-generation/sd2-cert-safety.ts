/**
 * SD 平台真人认证结果 ↔ 本地 videoRefSafety 映射。
 * 产品规则：设计/人物参考图须经移动 SD2（VideoFee）审核 active 后，方可作为方舟参考图生视频。
 */

import type { VideoRefSafety } from "@/projects/assets/types";

export const SD2_CERT_MODEL_TAG = "sd2-real-person-cert";

/** 已通过 SD 真人/需认证素材审核，可用于方舟参考图生视频 */
export function isSd2CertifiedForVideoRef(
  safety: VideoRefSafety | null | undefined,
): boolean {
  return (
    safety?.status === "ok" && safety.modelId === SD2_CERT_MODEL_TAG
  );
}

/** SD 认证明确失败/禁止 —— 不可再作为方舟人物参考 */
export function isSd2CertRejectedForVideoRef(
  safety: VideoRefSafety | null | undefined,
): boolean {
  return (
    safety?.status === "likely_real_person" &&
    safety.modelId === SD2_CERT_MODEL_TAG
  );
}

export function sd2CertOkSafety(reason?: string): VideoRefSafety {
  return {
    status: "ok",
    checkedAt: new Date().toISOString(),
    reason: reason ?? "已上传至 SD 审核资产库并通过认证，可用于视频生成",
    modelId: SD2_CERT_MODEL_TAG,
  };
}

export function sd2CertRejectedSafety(reason: string): VideoRefSafety {
  return {
    status: "likely_real_person",
    checkedAt: new Date().toISOString(),
    reason,
    modelId: SD2_CERT_MODEL_TAG,
  };
}

export function sd2CertFailedSafety(reason: string): VideoRefSafety {
  return {
    status: "check_failed",
    checkedAt: new Date().toISOString(),
    reason,
    modelId: SD2_CERT_MODEL_TAG,
  };
}
