import type { GenerationJobStatus } from "@/video-generation/types";
import type { ShotVideoUiStatus } from "@/projects/storyboard/shot-video-status";
import { mapGenerationToUiStatus } from "@/projects/storyboard/shot-video-status";

export type ShotGenerationSnapshot = {
  id: string;
  status: GenerationJobStatus;
  progress: number | null;
  errorMessage: string | null;
  completedAt: string | null;
  localVideoAssetId: string | null;
  actualDurationSeconds: number | null;
  actualResolution: string | null;
  providerModelId: string | null;
  isMock: boolean;
  /** 可选：用于同镜头多记录排序 */
  updatedAt?: string | null;
};

export type ResolvedShotVideo = {
  generation: ShotGenerationSnapshot | null;
  /** 用于播放的成功视频（失败时可能仍指向更早的成功记录） */
  playbackGeneration: ShotGenerationSnapshot | null;
  uiStatus: ShotVideoUiStatus;
  videoUrl: string | null;
  contentStale: boolean;
};

function isInFlight(status: GenerationJobStatus): boolean {
  return (
    status === "queued" ||
    status === "validating" ||
    status === "submitting" ||
    status === "processing" ||
    status === "downloading"
  );
}

function isFailed(status: GenerationJobStatus): boolean {
  return (
    status === "failed" ||
    status === "cancelled" ||
    status === "unknownOutcome" ||
    status === "resultTransferFailed"
  );
}

function toVideoUrl(
  localVideoAssetId: string | null | undefined,
  projectId: string,
): string | null {
  if (!localVideoAssetId) return null;
  return `/api/assets/${encodeURIComponent(localVideoAssetId)}?projectId=${encodeURIComponent(projectId)}`;
}

/**
 * 选择当前镜头应展示的生成记录。
 * 只使用传入的、已按 shotId 过滤的记录，绝不混用其他镜头。
 *
 * 优先级：
 * 1. 最新进行中记录
 * 2. 最新成功记录（可叠加 contentStale）
 * 3. 最新失败记录（若存在更早成功视频，仍可播放）
 */
export function resolveLatestShotVideoGeneration(params: {
  shotId: string;
  storyboardRevision?: number;
  contentStale: boolean;
  /** 当前镜头的生成记录（调用方必须已按 shotId 过滤） */
  generations: ShotGenerationSnapshot[];
  /** 兼容：仅有单条当前记录时使用 */
  generation?: ShotGenerationSnapshot | null;
  projectId: string;
}): ResolvedShotVideo {
  void params.shotId;
  void params.storyboardRevision;

  const rows = [...params.generations];
  if (params.generation && !rows.some((g) => g.id === params.generation!.id)) {
    rows.push(params.generation);
  }
  rows.sort((a, b) => {
    const ta = a.updatedAt || a.completedAt || "";
    const tb = b.updatedAt || b.completedAt || "";
    return tb.localeCompare(ta) || b.id.localeCompare(a.id);
  });

  if (rows.length === 0) {
    return {
      generation: null,
      playbackGeneration: null,
      uiStatus: params.contentStale ? "stale" : "pending",
      videoUrl: null,
      contentStale: params.contentStale,
    };
  }

  const latest = rows[0]!;
  const latestCompleted = rows.find(
    (g) => g.status === "completed" && g.localVideoAssetId,
  );

  if (isInFlight(latest.status)) {
    return {
      generation: latest,
      playbackGeneration: latestCompleted ?? null,
      uiStatus: mapGenerationToUiStatus(latest.status, false),
      videoUrl: toVideoUrl(latest.localVideoAssetId, params.projectId),
      contentStale: false,
    };
  }

  if (latest.status === "completed") {
    return {
      generation: latest,
      playbackGeneration: latest,
      uiStatus: mapGenerationToUiStatus(latest.status, params.contentStale),
      videoUrl: toVideoUrl(latest.localVideoAssetId, params.projectId),
      contentStale: params.contentStale,
    };
  }

  if (isFailed(latest.status)) {
    const playback = latestCompleted ?? null;
    return {
      generation: latest,
      playbackGeneration: playback,
      uiStatus: "failed",
      videoUrl: toVideoUrl(
        latest.localVideoAssetId ?? playback?.localVideoAssetId ?? null,
        params.projectId,
      ),
      contentStale: params.contentStale,
    };
  }

  return {
    generation: latest,
    playbackGeneration: latestCompleted ?? null,
    uiStatus: mapGenerationToUiStatus(latest.status, params.contentStale),
    videoUrl: toVideoUrl(
      latest.localVideoAssetId ?? latestCompleted?.localVideoAssetId ?? null,
      params.projectId,
    ),
    contentStale: params.contentStale,
  };
}
