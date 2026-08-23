/** Estimated progress helpers — never claimed as real 3080 provider progress. */

import type { ImageGenerationJobStatus } from "@/projects/assets/image-generation/types";

const STAGE_FLOOR: Record<ImageGenerationJobStatus, number> = {
  queued: 4,
  running: 12,
  saving: 88,
  succeeded: 100,
  save_failed: 100,
  timed_out_waiting: 70,
  failed: 100,
};

const STAGE_CAP: Record<ImageGenerationJobStatus, number> = {
  queued: 18,
  running: 82,
  saving: 96,
  succeeded: 100,
  save_failed: 100,
  timed_out_waiting: 82,
  failed: 100,
};

/**
 * Smooth estimated percent from status + elapsed ms since start.
 * Labeled in UI as 预计进度.
 */
export function estimateImageJobPercent(input: {
  status: ImageGenerationJobStatus;
  startedAt: string | null;
  createdAt: string;
  nowMs?: number;
}): number {
  const floor = STAGE_FLOOR[input.status];
  const cap = STAGE_CAP[input.status];
  if (floor >= 100) return 100;
  const start = Date.parse(input.startedAt ?? input.createdAt);
  const now = input.nowMs ?? Date.now();
  const elapsed = Number.isFinite(start) ? Math.max(0, now - start) : 0;
  // ~3 minutes to approach running cap
  const t = Math.min(1, elapsed / (3 * 60 * 1000));
  const eased = 1 - (1 - t) * (1 - t);
  return Math.round(floor + (cap - floor) * eased);
}

export function imageJobStageLabel(status: ImageGenerationJobStatus): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "生成中";
    case "saving":
      return "保存中";
    case "succeeded":
      return "已完成";
    case "save_failed":
      return "待重新保存";
    case "timed_out_waiting":
      return "等待确认中";
    case "failed":
      return "已失败";
    default:
      return "处理中";
  }
}
