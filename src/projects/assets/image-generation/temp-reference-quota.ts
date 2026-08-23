import "server-only";

import { listTempReferenceImages } from "@/projects/assets/image-generation/temp-reference-storage";
import {
  getTempReferenceQuotaBytes,
} from "@/projects/assets/image-generation/temp-reference-quota-config";
import { IMAGE_ERROR_USER_MESSAGE } from "@/projects/assets/image-generation/types";

export async function getTempReferenceUsageStats(projectId: string): Promise<{
  fileCount: number;
  usedBytes: number;
  quotaBytes: number;
  usageRatio: number;
}> {
  const items = await listTempReferenceImages(projectId);
  const usedBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
  const quotaBytes = getTempReferenceQuotaBytes();
  return {
    fileCount: items.length,
    usedBytes,
    quotaBytes,
    usageRatio: quotaBytes > 0 ? usedBytes / quotaBytes : 1,
  };
}

export async function assertTempReferenceQuotaAllows(input: {
  projectId: string;
  additionalBytes: number;
}): Promise<
  | { ok: true }
  | { ok: false; code: "TEMP_REFERENCE_STORAGE_LIMIT"; message: string }
> {
  if (input.additionalBytes <= 0) return { ok: true };
  const stats = await getTempReferenceUsageStats(input.projectId);
  if (stats.usedBytes + input.additionalBytes <= stats.quotaBytes) {
    return { ok: true };
  }
  const usedMb = (stats.usedBytes / (1024 * 1024)).toFixed(1);
  const quotaMb = (stats.quotaBytes / (1024 * 1024)).toFixed(1);
  return {
    ok: false,
    code: "TEMP_REFERENCE_STORAGE_LIMIT",
    message: `${IMAGE_ERROR_USER_MESSAGE.TEMP_REFERENCE_STORAGE_LIMIT}（当前约 ${usedMb} MB / 上限 ${quotaMb} MB）。请清理无引用参考图后再试。`,
  };
}
