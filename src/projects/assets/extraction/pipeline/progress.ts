import {
  DETAIL_PROGRESS_SPAN,
  RETRY_PROGRESS_MAX,
  RETRY_PROGRESS_MIN,
  ROSTER_PROGRESS_MAX,
} from "@/projects/assets/extraction/pipeline/constants";
import type { AssetExtractionStage } from "@/projects/assets/extraction/types";

export function computeExtractionProgress(input: {
  stage: AssetExtractionStage;
  rosterChunksCompleted: number;
  rosterChunksTotal: number;
  detailsCompleted: number;
  detailsTotal: number;
}): number {
  if (input.stage === "complete") return 100;
  if (input.stage === "saving") return 98;
  if (input.stage === "merging_roster") return ROSTER_PROGRESS_MAX;

  if (input.stage === "discovering_roster") {
    const total = Math.max(1, input.rosterChunksTotal);
    return Math.min(
      ROSTER_PROGRESS_MAX,
      Math.round((input.rosterChunksCompleted / total) * ROSTER_PROGRESS_MAX),
    );
  }

  const detailsTotal = Math.max(1, input.detailsTotal);
  const detailRatio = Math.min(1, input.detailsCompleted / detailsTotal);

  if (input.stage === "extracting_details") {
    return Math.min(
      RETRY_PROGRESS_MIN - 1,
      ROSTER_PROGRESS_MAX + Math.round(detailRatio * DETAIL_PROGRESS_SPAN),
    );
  }

  return Math.min(
    RETRY_PROGRESS_MAX,
    Math.max(
      RETRY_PROGRESS_MIN,
      RETRY_PROGRESS_MIN + Math.round(detailRatio * (RETRY_PROGRESS_MAX - RETRY_PROGRESS_MIN)),
    ),
  );
}

export function batchItems<T>(items: T[], size: number): T[][] {
  if (size <= 0) return items.length ? [items] : [];
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
