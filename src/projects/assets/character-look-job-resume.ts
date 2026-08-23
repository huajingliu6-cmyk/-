import type { AssetGenerationProgress } from "@/projects/assets/DesignGenerationOverlay";
import type { ImageGenerationJob } from "@/projects/assets/image-generation/types";
import { IMAGE_JOB_ACTIVE_STATUSES } from "@/projects/assets/image-generation/types";

export function shouldResumeLibraryLookJob(
  job: ImageGenerationJob | null | undefined,
  options: { ownedJobIds: ReadonlySet<string>; appliedJobId: string | null },
): job is ImageGenerationJob {
  if (!job || job.sourceEntry !== "library_look") return false;
  if (options.ownedJobIds.has(job.id)) return false;

  if (IMAGE_JOB_ACTIVE_STATUSES.includes(job.status)) return true;

  return (
    (job.status === "succeeded" || job.status === "save_failed") &&
    !job.savedToLibrary &&
    Boolean(job.primaryMediaId) &&
    options.appliedJobId !== job.id
  );
}

export function progressForResumedLibraryLookJob(
  job: ImageGenerationJob,
): AssetGenerationProgress {
  if (job.status === "saving") {
    return { stage: "saving", percent: 88, message: "正在保存图片" };
  }
  return {
    stage: "generating",
    percent: Math.max(38, job.estimatedPercent ?? 38),
    message: "正在生成图片",
  };
}
