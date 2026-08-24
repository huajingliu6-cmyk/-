import type { PersonalImageHistoryItem } from "@/personal/image-generation/types";
import { isAcceptedImageFile } from "@/personal/accepted-image-file";
import { safeRandomUUID } from "@/lib/safe-random-id";

export type PersonalReferenceImage = {
  id: string;
  file: File;
  previewUrl: string;
};

export function createReferenceImage(file: File): PersonalReferenceImage {
  return {
    id: `ref_${safeRandomUUID().replace(/-/g, "").slice(0, 12)}`,
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

export function revokeReferenceImages(refs: PersonalReferenceImage[]): void {
  for (const ref of refs) {
    URL.revokeObjectURL(ref.previewUrl);
  }
}

export function mergeReferenceFiles(
  current: PersonalReferenceImage[],
  incoming: File[],
  max: number,
): PersonalReferenceImage[] {
  const next = [...current];
  for (const file of incoming) {
    if (!isAcceptedImageFile(file)) continue;
    if (next.length >= max) break;
    next.push(createReferenceImage(file));
  }
  return next;
}

export function downloadPersonalImage(item: PersonalImageHistoryItem): void {
  const anchor = document.createElement("a");
  anchor.href = item.imageUrl;
  anchor.download = `personal-image-${item.id}.png`;
  anchor.rel = "noopener";
  anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function formatPersonalImageDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function defaultPersonalMaterialName(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return `生图 ${safeRandomUUID().slice(0, 8)}`;
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}
