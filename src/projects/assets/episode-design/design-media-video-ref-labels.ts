import type {
  EpisodeAssetDesignAssetType,
  EpisodeAssetDesignItem,
  GeneratedMediaState,
} from "@/projects/assets/episode-design/types";
import type { VideoRefSafety } from "@/projects/assets/types";
import { isSd2CertifiedForVideoRef } from "@/video-generation/sd2-cert-safety";

/** 已通过 SD2 真人认证的图片不可再校验（客户端/服务端均可引用）。 */
export function isDesignMediaVideoRefLocked(
  safety: VideoRefSafety | null | undefined,
): boolean {
  return isSd2CertifiedForVideoRef(safety);
}

/**
 * Safety for the *current* generated image only.
 * Prefer the history entry for currentId so a prior image's top-level
 * videoRefSafety cannot fake “已校验” after the user switches media.
 */
export function getCurrentDesignMediaVideoRefSafety(
  media: GeneratedMediaState | null | undefined,
): VideoRefSafety | null {
  const currentId = media?.currentId?.trim();
  if (!media || !currentId) return null;
  const historyEntry = media.history?.find((h) => h.mediaId === currentId);
  if (historyEntry) {
    return historyEntry.videoRefSafety ?? null;
  }
  if (media.videoRefSafety) return media.videoRefSafety;
  return null;
}

/**
 * Personal project-management “确认入库”: block characters whose *current*
 * image has not passed SD2 person certification (`isSd2CertifiedForVideoRef`).
 * Scenes/props are never blocked by person cert. Risk / pending / failed / missing ≠ pass.
 * `status === "ok"` alone (non-SD2 model) must not pass.
 */
export function characterNeedsUncheckedVideoRefBlock(
  item: Pick<
    EpisodeAssetDesignItem,
    "assetType" | "generatedMedia" | "libraryAssetId"
  >,
): boolean {
  if (item.assetType !== "character") return false;
  if (item.libraryAssetId?.trim()) return false;
  const mediaId = item.generatedMedia?.currentId?.trim();
  if (!mediaId) return false;
  return !isSd2CertifiedForVideoRef(
    getCurrentDesignMediaVideoRefSafety(item.generatedMedia),
  );
}

export function designVideoRefSafetyBadge(
  safety: VideoRefSafety | null | undefined,
): {
  label: string;
  tone: "ok" | "risk" | "warn" | "muted" | "pending";
} | null {
  if (!safety) return null;
  if (isSd2CertifiedForVideoRef(safety)) {
    return { label: "SD 已认证", tone: "ok" };
  }
  switch (safety.status) {
    case "ok":
      return { label: "需重新人物校验", tone: "warn" };
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
  if (isSd2CertifiedForVideoRef(safety)) {
    return `${subject}已上传至 SD 审核资产库并通过认证，可用于视频生成`;
  }
  switch (safety.status) {
    case "ok":
      return `${subject}尚未通过移动 SD2 真人素材认证，请点击「人物校验」完成认证后再入库`;
    case "likely_real_person":
      return `${subject}未通过 SD 真人素材认证（疑似真人/不可用）。建议改用插画、设定图或三视图后重新生成，再点「人物校验」`;
    case "other_risk":
      return `${subject}存在参考风险：${safety.reason ?? "建议更换图片后再用于视频"}`;
    case "pending":
      return `${subject}正在上传至 SD 审核资产库…`;
    case "check_failed":
      return `${subject}人物校验未完成：${safety.reason ?? "请到系统管理 → API 接口配置「移动 SD2 平台」后重试"}`;
    default:
      return `${subject}校验结果未知`;
  }
}
