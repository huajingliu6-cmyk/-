import type { ShotGenerationSnapshot } from "@/projects/storyboard/resolve-shot-video";

export const SHOT_VIDEO_PREVIEW_PAGE_SIZE = 3;

export type ShotVideoHistoryItem = {
  id: string;
  videoUrl: string;
  downloadUrl: string;
  completedAt: string | null;
  actualDurationSeconds: number | null;
  actualResolution: string | null;
  providerModelId: string | null;
  isMock: boolean;
  /** 按生成时间从旧到新编号：版本 1、版本 2… */
  versionLabel: string;
  /** 若来自其他镜头归档，显示来源提示 */
  sourceShotLabel?: string | null;
};

export function shotVideoPlaybackUrl(
  localVideoAssetId: string,
  projectId: string,
  generationId: string,
): string {
  return `/api/assets/${encodeURIComponent(localVideoAssetId)}?projectId=${encodeURIComponent(projectId)}&generationId=${encodeURIComponent(generationId)}`;
}

export function shotVideoDownloadUrl(
  localVideoAssetId: string,
  projectId: string,
  generationId: string,
): string {
  return `${shotVideoPlaybackUrl(localVideoAssetId, projectId, generationId)}&download=1`;
}

export function assignVersionLabels<
  T extends { id: string; completedAt: string | null },
>(items: T[]): Array<T & { versionLabel: string }> {
  const oldestFirst = [...items].sort((a, b) => {
    const ta = a.completedAt || "";
    const tb = b.completedAt || "";
    return ta.localeCompare(tb) || a.id.localeCompare(b.id);
  });
  const versionById = new Map(
    oldestFirst.map((item, index) => [item.id, `版本 ${index + 1}`]),
  );
  return items.map((item) => ({
    ...item,
    versionLabel: versionById.get(item.id) ?? "版本 ?",
  }));
}

/** 仅可播放的成功视频，按时间新→旧，并标注版本号 */
export function listPlayableShotVideos(params: {
  projectId: string;
  generations: ShotGenerationSnapshot[];
  currentShotId?: string;
  shotNumberById?: Map<string, number>;
}): ShotVideoHistoryItem[] {
  const rows = params.generations
    .filter(
      (g) => g.status === "completed" && Boolean(g.localVideoAssetId),
    )
    .slice()
    .sort((a, b) => {
      const ta = a.updatedAt || a.completedAt || "";
      const tb = b.updatedAt || b.completedAt || "";
      return tb.localeCompare(ta) || b.id.localeCompare(a.id);
    });

  const seen = new Set<string>();
  const out: Omit<ShotVideoHistoryItem, "versionLabel">[] = [];
  for (const g of rows) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    const assetId = g.localVideoAssetId!;
    const sourceShotId = (g as ShotGenerationSnapshot & { sourceShotId?: string })
      .sourceShotId;
    let sourceShotLabel: string | null = null;
    if (
      sourceShotId &&
      params.currentShotId &&
      sourceShotId !== params.currentShotId
    ) {
      const num = params.shotNumberById?.get(sourceShotId);
      sourceShotLabel =
        num != null
          ? `原镜头 ${String(num).padStart(2, "0")}`
          : "本集归档";
    }
    out.push({
      id: g.id,
      videoUrl: shotVideoPlaybackUrl(assetId, params.projectId, g.id),
      downloadUrl: shotVideoDownloadUrl(assetId, params.projectId, g.id),
      completedAt: g.completedAt,
      actualDurationSeconds: g.actualDurationSeconds,
      actualResolution: g.actualResolution,
      providerModelId: g.providerModelId,
      isMock: g.isMock,
      sourceShotLabel,
    });
  }
  return assignVersionLabels(out);
}

export function pageShotVideoHistory<T>(
  items: T[],
  offset: number,
  pageSize = SHOT_VIDEO_PREVIEW_PAGE_SIZE,
): {
  page: T[];
  offset: number;
  canPrev: boolean;
  canNext: boolean;
  total: number;
} {
  const total = items.length;
  const maxStart =
    total === 0 ? 0 : Math.floor((total - 1) / pageSize) * pageSize;
  const aligned = Math.max(0, Math.min(offset, maxStart));
  return {
    page: items.slice(aligned, aligned + pageSize),
    offset: aligned,
    canPrev: aligned > 0,
    canNext: aligned + pageSize < total,
    total,
  };
}
