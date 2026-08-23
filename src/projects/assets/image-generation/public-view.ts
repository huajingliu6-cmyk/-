import { estimateImageJobPercent } from "@/projects/assets/image-generation/estimated-progress";
import { imageJobStageLabel } from "@/projects/assets/image-generation/estimated-progress";
import type { ImageGenerationJob } from "@/projects/assets/image-generation/types";

/** API/client-safe job payload with fresh estimated percent. */
export function publicImageJobView(job: ImageGenerationJob) {
  const estimatedPercent = estimateImageJobPercent({
    status: job.status,
    startedAt: job.startedAt,
    createdAt: job.createdAt,
  });
  return {
    ...job,
    estimatedPercent,
    stageLabel: imageJobStageLabel(job.status),
    progressLabel: "预计进度",
  };
}
