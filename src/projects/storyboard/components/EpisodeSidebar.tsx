"use client";

import { useMemo, useState } from "react";
import type { ScriptEpisode } from "@/projects/script/types";
import {
  EPISODE_STATUS_LABEL,
  type EpisodeProduction,
  type EpisodeProductionStatus,
} from "@/projects/storyboard/types";

/** 分镜创作左侧剧集列表每页最多显示集数 */
export const STORYBOARD_EPISODES_PER_PAGE = 10;

type Props = {
  episodes: ScriptEpisode[];
  productions: EpisodeProduction[];
  activeEpisodeId: string | null;
  switching: boolean;
  onSelect: (episodeId: string) => void;
};

export function pageForEpisodeId(
  episodes: ScriptEpisode[],
  episodeId: string | null,
  perPage: number = STORYBOARD_EPISODES_PER_PAGE,
): number {
  if (!episodeId) return 1;
  const index = episodes.findIndex((episode) => episode.id === episodeId);
  if (index < 0) return 1;
  return Math.floor(index / perPage) + 1;
}

function videoBatchStatusLabel(
  production: EpisodeProduction | undefined,
): string {
  const batch = production?.videoGenerationBatch;
  if (!batch || batch.shots.length === 0) {
    if (production?.status === "storyboard_done") return "可生成视频";
    return (
      EPISODE_STATUS_LABEL[
        (production?.status ?? "awaiting_script") as EpisodeProductionStatus
      ] ?? "待处理"
    );
  }

  const statuses = batch.shots.map((s) => s.status.toLowerCase());
  const running = statuses.some((s) =>
    [
      "queued",
      "validating",
      "submitting",
      "processing",
      "downloading",
      "resulttransferfailed",
      "running",
      "pending",
      "submitted",
    ].includes(s),
  );
  if (running) return "视频生成中";

  const failed = statuses.filter((s) =>
    ["failed", "error", "cancelled", "unknownoutcome"].includes(s),
  ).length;
  const succeeded = statuses.filter((s) =>
    ["succeeded", "success", "completed", "done"].includes(s),
  ).length;

  if (failed > 0 && succeeded > 0) {
    return `视频 ${succeeded}/${batch.shots.length}`;
  }
  if (failed > 0 && succeeded === 0) return "视频生成失败";
  if (succeeded === batch.shots.length) return "视频已生成";
  if (succeeded > 0) return `视频 ${succeeded}/${batch.shots.length}`;

  return (
    EPISODE_STATUS_LABEL[
      (production?.status ?? "awaiting_script") as EpisodeProductionStatus
    ] ?? "待处理"
  );
}

export function EpisodeSidebar({
  episodes,
  productions,
  activeEpisodeId,
  switching,
  onSelect,
}: Props) {
  const productionByEpisodeId = useMemo(() => {
    const map = new Map<string, EpisodeProduction>();
    for (const production of productions) {
      map.set(production.episodeId, production);
    }
    return map;
  }, [productions]);

  const totalPages = Math.max(
    1,
    Math.ceil(episodes.length / STORYBOARD_EPISODES_PER_PAGE),
  );
  const derivedPage = pageForEpisodeId(episodes, activeEpisodeId);
  const [page, setPage] = useState(derivedPage);
  const [syncedActiveId, setSyncedActiveId] = useState(activeEpisodeId);

  if (activeEpisodeId !== syncedActiveId) {
    setSyncedActiveId(activeEpisodeId);
    setPage(pageForEpisodeId(episodes, activeEpisodeId));
  }

  const safePage = Math.min(Math.max(1, page), totalPages);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * STORYBOARD_EPISODES_PER_PAGE;
    return episodes.slice(start, start + STORYBOARD_EPISODES_PER_PAGE);
  }, [episodes, safePage]);

  return (
    <aside className="sbw-panel sbw-episode-sidebar">
      <div className="sbw-panel__head">
        <h2>剧集列表</h2>
      </div>
      <div className="sbw-panel__body sbw-episode-sidebar__body">
        {episodes.length === 0 ? (
          <div className="sbw-empty">暂无分集</div>
        ) : (
          <>
            <div className="sbw-episode-compact-list">
              {pageItems.map((episode) => {
                const selected = episode.id === activeEpisodeId;
                const production = productionByEpisodeId.get(episode.id);
                const statusLabel = videoBatchStatusLabel(production);
                return (
                  <button
                    key={episode.id}
                    type="button"
                    className={`sbw-episode-compact${selected ? " is-selected" : ""}`}
                    disabled={switching}
                    onClick={() => onSelect(episode.id)}
                    title={`第${episode.episodeNumber}集 · ${statusLabel}`}
                    data-testid={`episode-sidebar-${episode.id}`}
                  >
                    <span className="sbw-episode-compact__title">
                      第{episode.episodeNumber}集
                    </span>
                    <span className="sbw-episode-compact__status">
                      {statusLabel}
                    </span>
                  </button>
                );
              })}
            </div>
            {totalPages > 1 ? (
              <div className="sbw-pager sbw-pager--compact">
                <button
                  type="button"
                  className="sbw-btn"
                  disabled={safePage <= 1 || switching}
                  onClick={() => setPage(safePage - 1)}
                >
                  上
                </button>
                <span className="sbw-pager__label">
                  {safePage}/{totalPages}
                </span>
                <button
                  type="button"
                  className="sbw-btn"
                  disabled={safePage >= totalPages || switching}
                  onClick={() => setPage(safePage + 1)}
                >
                  下
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
