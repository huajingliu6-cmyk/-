import type { PersonalAsset, PersonalAssetCategory } from "@/personal-assets/types";
import {
  PERSONAL_ASSET_CATEGORY_LABELS,
  formatPersonalAssetBytes,
  personalAssetMediaUrl,
} from "@/personal-assets/constants";
import { isAcceptedImageFile } from "@/personal/accepted-image-file";

export type UploadQueueItemStatus =
  | "pending"
  | "uploading"
  | "completed"
  | "failed"
  | "cancelled";

export type UploadQueueItem = {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  category: PersonalAssetCategory;
  status: UploadQueueItemStatus;
  error?: string;
  asset?: PersonalAsset;
};

export function assetImageUrl(asset: PersonalAsset): string {
  return personalAssetMediaUrl(asset.storageKey);
}

export function assetDownloadUrl(asset: PersonalAsset): string {
  return `/api/personal-assets/${encodeURIComponent(asset.id)}/download`;
}

export function formatAssetDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function sourceTypeLabel(asset: PersonalAsset): string {
  if (asset.sourceType === "ai_image") return "AI 生图";
  if (asset.sourceType === "market_reference") return "素材市场";
  return "手动上传";
}

export function categoryLabel(category: PersonalAssetCategory): string {
  return PERSONAL_ASSET_CATEGORY_LABELS[category];
}

export function formatUsage(usedBytes: number, quotaBytes: number): string {
  return `${formatPersonalAssetBytes(usedBytes)} / ${formatPersonalAssetBytes(quotaBytes)}`;
}

export function usagePercent(usedBytes: number, quotaBytes: number): number {
  if (quotaBytes <= 0) return 0;
  return Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
}

export function clampPopoverPosition(input: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { left: number; top: number } {
  const margin = 12;
  const maxLeft = Math.max(margin, window.innerWidth - input.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - input.height - margin);
  return {
    left: Math.min(Math.max(margin, input.x), maxLeft),
    top: Math.min(Math.max(margin, input.y), maxTop),
  };
}

export async function downloadAssetFile(asset: PersonalAsset): Promise<void> {
  const response = await fetch(assetDownloadUrl(asset), { credentials: "include" });
  if (!response.ok) throw new Error("下载失败");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = asset.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function isImageFile(file: File): boolean {
  return isAcceptedImageFile(file);
}

export function defaultAssetName(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, "").trim();
  return base || "未命名素材";
}
