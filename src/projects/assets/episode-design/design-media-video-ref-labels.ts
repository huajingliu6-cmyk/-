import type { EpisodeAssetDesignAssetType } from "@/projects/assets/episode-design/types";
import type { VideoRefSafety } from "@/projects/assets/types";

/** 已通过 SD 认证的图片不可再校验（客户端/服务端均可引用）。 */
export function isDesignMediaVideoRefLocked(
  safety: VideoRefSafety | null | undefined,
): boolean {
  return safety?.status === "ok";
}

export function designVideoRefSafetyBadge(
  safety: VideoRefSafety | null | undefined,
): {
  label: string;
  tone: "ok" | "risk" | "warn" | "muted" | "pending";
} | null {
  if (!safety) return null;
  switch (safety.status) {
    case "ok":
      return { label: "SD 已认证", tone: "ok" };
    case "likely_real_person":
      return { label: "疑似真人", tone: "risk" };
    case "other_risk":
      return { label: "参考风险", tone: "warn" };
    case "pending":
      return { label: "校验中", tone: "pending" };
    case "check_failed":
      return { label: "校验失败", tone: "muted" };
    default:
      return null;
  }
}

export function formatDesignVideoRefSafetyNotice(
  safety: VideoRefSafety,
  assetType: EpisodeAssetDesignAssetType,
): string {
  const subject =
    assetType === "character"
      ? "人物参考图"
      : assetType === "scene"
        ? "场景参考图"
        : assetType === "prop"
          ? "道具参考图"
          : "参考图";
  switch (safety.status) {
    case "ok":
      return `${subject}已上传至 SD 审核资产库并通过认证，可用于视频生成`;
    case "likely_real_person":
      return `${subject}未通过 SD 真人素材认证（疑似真人/不可用）。建议改用插画、设定图或三视图后重新生成，再点「人物校验」`;
    case "other_risk":
      return `${subject}存在参考风险：${safety.reason ?? "建议更换图片后再用于视频"}`;
    case "pending":
      return `${subject}正在上传至 SD 审核资产库…`;
    case "check_failed":
      return `${subject}人物校验未完成：${safety.reason ?? "请到管理 API 配置「移动 SD2 平台」后重试"}`;
    default:
      return `${subject}校验结果未知`;
  }
}
