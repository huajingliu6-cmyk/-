import type { GenerationJobStatus } from "@/video-generation/types";

export type ShotVideoUiStatus =
  | "pending"
  | "queued"
  | "submitting"
  | "processing"
  | "completed"
  | "failed"
  | "stale";

export function mapGenerationToUiStatus(
  status: GenerationJobStatus | null | undefined,
  contentStale: boolean,
): ShotVideoUiStatus {
  if (contentStale) return "stale";
  if (!status) return "pending";
  if (status === "queued") return "queued";
  if (status === "validating" || status === "submitting") return "submitting";
  if (status === "processing" || status === "downloading") {
    return "processing";
  }
  if (status === "completed") return "completed";
  if (
    status === "failed" ||
    status === "cancelled" ||
    status === "unknownOutcome" ||
    status === "resultTransferFailed"
  ) {
    return "failed";
  }
  return "pending";
}
