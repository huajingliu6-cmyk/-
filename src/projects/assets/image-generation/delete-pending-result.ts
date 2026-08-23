import "server-only";

import {
  deleteProjectAssetImageFile,
  findImageableAssetInDraft,
  isSafeProjectAssetImageId,
} from "@/projects/assets/asset-image-storage";
import { loadAssetBundleForScope } from "@/projects/assets/asset-bundle-scope";
import {
  readImageGenerationJob,
  updateImageGenerationJob,
} from "@/projects/assets/image-generation/store";
import type { ImageGenerationJob } from "@/projects/assets/image-generation/types";

function bundleReferencesMedia(
  draft: NonNullable<Awaited<ReturnType<typeof loadAssetBundleForScope>>>,
  mediaId: string,
): boolean {
  for (const character of draft.characters) {
    const ids = [
      ...(character.approvedMediaIds ?? []),
      ...(character.historyMediaIds ?? []),
      ...(character.lookMediaIds ?? []),
      character.primaryMediaId,
      character.imageFileName,
    ];
    if (ids.some((id) => id === mediaId)) return true;
  }
  for (const scene of draft.scenes) {
    const ids = [
      ...(scene.approvedMediaIds ?? []),
      scene.primaryMediaId,
      scene.imageFileName,
    ];
    if (ids.some((id) => id === mediaId)) return true;
  }
  for (const prop of draft.props) {
    const ids = [
      ...(prop.approvedMediaIds ?? []),
      prop.primaryMediaId,
      prop.imageFileName,
    ];
    if (ids.some((id) => id === mediaId)) return true;
  }
  return false;
}

/**
 * Delete unsaved temporary generation blobs for a job.
 * Never deletes media referenced by library assets.
 */
export async function deleteImageJobPendingResult(
  jobId: string,
): Promise<
  | { ok: true; job: ImageGenerationJob; deletedMediaIds: string[] }
  | { ok: false; code: string; message: string; status: number }
> {
  const job = await readImageGenerationJob(jobId);
  if (!job) {
    return {
      ok: false,
      code: "JOB_NOT_FOUND",
      message: "找不到该生成任务",
      status: 404,
    };
  }
  if (job.savedToLibrary) {
    return {
      ok: false,
      code: "RETRY_NOT_ALLOWED",
      message: "结果已入库，不能按临时结果删除",
      status: 409,
    };
  }

  const draft = await loadAssetBundleForScope(job.projectId, job.scope);
  const deletedMediaIds: string[] = [];
  for (const mediaId of job.mediaIds) {
    if (!isSafeProjectAssetImageId(mediaId) || !mediaId.startsWith("gen_")) {
      continue;
    }
    if (draft && bundleReferencesMedia(draft, mediaId)) {
      continue;
    }
    // Also ensure this media is not another asset's primary via find
    if (draft && findImageableAssetInDraft(draft, mediaId)) {
      continue;
    }
    await deleteProjectAssetImageFile(job.projectId, mediaId).catch(
      () => undefined,
    );
    deletedMediaIds.push(mediaId);
  }

  const next = await updateImageGenerationJob(jobId, {
    mediaIds: [],
    primaryMediaId: null,
    mimeType: null,
    status: "failed",
    errorCode: "UNKNOWN_ERROR",
    errorMessage: "已删除未入库的生成结果",
    savedToLibrary: false,
    completedAt: new Date().toISOString(),
  });

  return { ok: true, job: next, deletedMediaIds };
}
