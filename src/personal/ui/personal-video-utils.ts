import type { VideoRefSafety } from "@/projects/assets/types";
import { isAcceptedImageFile } from "@/personal/accepted-image-file";
import { safeRandomUUID } from "@/lib/safe-random-id";
import type {
  PersonalVideoHistoryItem,
  PersonalVideoPrecheckStatus,
} from "@/personal/video-generation/types";import type { GenerationJobStatus } from "@/video-generation/types";
import { mapGenerationToUiStatus } from "@/projects/storyboard/shot-video-status";
import { isSd2CertifiedForVideoRef } from "@/video-generation/sd2-cert-safety";

export type PersonalVideoReference = {
  id: string;
  file: File;
  previewUrl: string;
  precheckStatus: PersonalVideoPrecheckStatus;
  precheckMessage?: string;
};

export function createVideoReference(file: File): PersonalVideoReference {
  return {
    id: `vref_${safeRandomUUID().replace(/-/g, "").slice(0, 12)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    precheckStatus: "idle",
  };
}

export function revokeVideoReferences(refs: PersonalVideoReference[]): void {
  for (const ref of refs) {
    URL.revokeObjectURL(ref.previewUrl);
  }
}

export function mergeVideoReferenceFiles(
  current: PersonalVideoReference[],
  incoming: File[],
): PersonalVideoReference[] {
  const next = [...current];
  for (const file of incoming) {
    if (!isAcceptedImageFile(file)) continue;
    next.push(createVideoReference(file));
  }
  return next;
}

export function mapApiPrecheckToStatus(
  safety: VideoRefSafety,
  blocked: boolean,
): PersonalVideoPrecheckStatus {
  if (isSd2CertifiedForVideoRef(safety)) return "ok";
  if (blocked || safety.status === "likely_real_person") {
    return "likely_real_person";
  }
  if (safety.status === "other_risk") return "other_risk";
  if (safety.status === "check_failed") return "check_failed";
  if (safety.status === "pending") return "checking";
  return "check_failed";
}

export function personalVideoPrecheckNotice(
  status: PersonalVideoPrecheckStatus,
  message?: string,
): string | null {
  switch (status) {
    case "idle":
      return null;
    case "checking":
      return "正在上传至 SD 审核资产库…";
    case "ok":
      return "人物参考图已上传至 SD 审核资产库并通过认证，可用于视频生成";
    case "likely_real_person":
      return (
        message ??
        "参考图未通过 SD 真人素材认证（疑似真人/不可用）。请改用插画、设定图或三视图后重新上传。"
      );
    case "other_risk":
      return message ?? "参考图存在风险，请更换图片后再试";
    case "check_failed":
      return (
        message ??
        "人物校验未完成：请到系统管理 → API 接口配置「移动 SD2 平台」后重试"
      );
    default:
      return null;
  }
}

export function referencesAllowGenerate(
  references: PersonalVideoReference[],
): boolean {
  if (references.length === 0) return true;
  return references.every((ref) => ref.precheckStatus === "ok");
}

export function referencesNeedPrecheck(
  references: PersonalVideoReference[],
): boolean {
  return references.some(
    (ref) =>
      ref.precheckStatus === "idle" ||
      ref.precheckStatus === "checking",
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待生成",
  queued: "排队中",
  submitting: "提交中",
  processing: "生成中",
  completed: "已完成",
  failed: "生成失败",
  stale: "内容已过期",
};

export function personalVideoStatusLabel(
  status: GenerationJobStatus | null | undefined,
): string {
  const ui = mapGenerationToUiStatus(status, false);
  return STATUS_LABELS[ui] ?? ui;
}

export function isPersonalVideoProcessing(
  status: GenerationJobStatus | null | undefined,
): boolean {
  const ui = mapGenerationToUiStatus(status, false);
  return (
    ui === "queued" ||
    ui === "submitting" ||
    ui === "processing" ||
    ui === "pending"
  );
}

export function formatPersonalVideoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function clampPersonalVideoDuration(value: number): number {
  return Math.min(15, Math.max(5, Math.round(value)));
}

export function downloadPersonalVideo(item: PersonalVideoHistoryItem): void {
  if (!item.videoUrl) return;
  const anchor = document.createElement("a");
  anchor.href = item.videoUrl;
  anchor.download = `personal-video-${item.id}.mp4`;
  anchor.rel = "noopener";
  anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
