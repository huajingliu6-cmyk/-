import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  findProduction,
  loadAuthorizedWorkspace,
} from "@/projects/storyboard/api-helpers";
import type { ShotGenerationSnapshot } from "@/projects/storyboard/resolve-shot-video";
import { listPlayableShotVideos } from "@/projects/storyboard/shot-video-history";
import {
  listGenerationRecords,
  readGenerationRecord,
} from "@/video-generation/generation-store";
import { sanitizeGenerationForClient } from "@/video-generation/secure-transfer";
import type { GenerationJobStatus } from "@/video-generation/types";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; shotId: string }>;
};

function toSnapshot(
  g: ReturnType<typeof sanitizeGenerationForClient>,
): ShotGenerationSnapshot & { sourceShotId?: string } {
  return {
    id: g.id,
    status: g.status as GenerationJobStatus,
    progress: g.progress,
    errorMessage: g.errorMessage,
    completedAt: g.completedAt,
    localVideoAssetId: g.localVideoAssetId,
    actualDurationSeconds: g.actualDurationSeconds,
    actualResolution:
      g.actualWidth && g.actualHeight
        ? `${g.actualWidth}x${g.actualHeight}`
        : g.providerResolution,
    providerModelId: g.providerModelId,
    isMock: g.isMock,
    updatedAt: g.updatedAt,
    sourceShotId: g.shotNodeId,
  };
}

/**
 * GET 当前镜头可播放的视频生成历史。
 * 来源：当前镜头历史 ID + 同 shotNodeId 旧记录（兼容）。
 * 不删除任何历史；修改剧本/重生分镜后仍可读。
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const { projectId, episodeId, shotId } = await context.params;
  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const production = findProduction(loaded.context.workspace, episodeId);
  if (!production) {
    return NextResponse.json({ error: "分集制作不存在" }, { status: 404 });
  }

  const storyboard = production.activeStoryboard;
  const flatShots =
    storyboard?.scenes.flatMap((s) => s.shots) ?? [];
  const shot = flatShots.find((s) => s.id === shotId);
  if (!shot || !storyboard) {
    return NextResponse.json({ error: "镜头不存在" }, { status: 404 });
  }

  const historyIds = Array.from(
    new Set([...(shot.videoHistoryGenerationIds ?? []), shot.lastGenerationId]),
  ).filter((id): id is string => Boolean(id));
  const byId = new Map<string, ShotGenerationSnapshot & { sourceShotId?: string }>();

  for (const id of historyIds) {
    const record = await readGenerationRecord(id);
    if (!record || record.projectId !== projectId) continue;
    if (record.shotNodeId && record.shotNodeId !== shotId) continue;
    const snap = toSnapshot(sanitizeGenerationForClient(record));
    byId.set(snap.id, snap);
  }

  // 兼容：尚未写入 history 列表的旧成功记录
  const all = await listGenerationRecords();
  for (const record of all) {
    if (record.projectId !== projectId) continue;
    if (
      record.shotNodeId !== shotId &&
      !(record.shotNodeId == null && historyIds.includes(record.id))
    ) {
      continue;
    }
    if (
      record.shotNodeId === shotId ||
      (record.shotNodeId == null && historyIds.includes(record.id))
    ) {
      const snap = toSnapshot(sanitizeGenerationForClient(record));
      if (!byId.has(snap.id)) byId.set(snap.id, snap);
    }
  }

  const shotNumberById = new Map(
    flatShots.map((s) => [s.id, s.shotNumber] as const),
  );

  const videos = listPlayableShotVideos({
    projectId,
    generations: [...byId.values()],
    currentShotId: shotId,
    shotNumberById,
  });

  return NextResponse.json({
    shotId,
    videos,
    latestGenerationId: shot.lastGenerationId,
  });
}
