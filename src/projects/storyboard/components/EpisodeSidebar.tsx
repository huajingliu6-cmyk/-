"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { List } from "lucide-react";
import type { ScriptEpisode } from "@/projects/script/types";
import {
  EPISODE_STATUS_LABEL,
  type EpisodeProduction,
  type EpisodeProductionStatus,
} from "@/projects/storyboard/types";
import {
  EPISODE_PROMPT_GEN_STATUS_LABEL,
  resolveEpisodePromptGenDisplayStatus,
  type EpisodePromptGenJob,
} from "@/projects/storyboard/prompt-generation-manager";

/** 分镜创作左侧剧集列表每页最多显示集数 */
export const STORYBOARD_EPISODES_PER_PAGE = 10;

/** 鼠标离开后自动收回延迟（ms） */
export const EPISODE_DRAWER_CLOSE_DELAY_MS = 250;

type Props = {
  episodes: ScriptEpisode[];
  productions: EpisodeProduction[];
  activeEpisodeId: string | null;
  switching: boolean;
  onSelect: (episodeId: string) => void;
  promptJobs?: Record<string, EpisodePromptGenJob>;
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
  promptJob?: EpisodePromptGenJob | null,
): string {
  const promptStatus = resolveEpisodePromptGenDisplayStatus({
    productionStatus: production?.status,
    hasStoryboard: Boolean(production?.activeStoryboard),
    job: promptJob,
  });
  if (
    promptStatus === "generating" ||
    promptStatus === "queued" ||
    promptStatus === "failed"
  ) {
    return EPISODE_PROMPT_GEN_STATUS_LABEL[promptStatus];
  }

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

function subscribeFineHover(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function readFineHover(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function useFineHover(): boolean {
  return useSyncExternalStore(subscribeFineHover, readFineHover, () => true);
}

export function EpisodeSidebar({
  episodes,
  productions,
  activeEpisodeId,
  switching,
  onSelect,
  promptJobs,
}: Props) {
  const canHover = useFineHover();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);

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

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openDrawer = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      const root = rootRef.current;
      if (root && root.contains(document.activeElement)) {
        return;
      }
      setOpen(false);
    }, EPISODE_DRAWER_CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  useEffect(() => {
    return () => clearCloseTimer();
  }, [clearCloseTimer]);

  const handleToggle = useCallback(() => {
    clearCloseTimer();
    setOpen((prev) => !prev);
  }, [clearCloseTimer]);

  return (
    <div
      ref={rootRef}
      className={`sbw-episode-drawer${open ? " is-open" : ""}`}
      data-testid="episode-sidebar-drawer"
      data-open={open ? "true" : "false"}
      onMouseEnter={() => {
        if (canHover) openDrawer();
      }}
      onMouseLeave={() => {
        if (canHover) scheduleClose();
      }}
      onFocusCapture={openDrawer}
      onBlurCapture={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && rootRef.current?.contains(next)) return;
        scheduleClose();
      }}
    >
      <aside
        className="sbw-episode-drawer__panel"
        aria-label="剧集列表"
        aria-hidden={!open}
        id="sbw-episode-drawer-panel"
      >
        <div className="sbw-episode-drawer__head">
          <h2>剧集列表</h2>
        </div>
        <div className="sbw-episode-drawer__body">
          {episodes.length === 0 ? (
            <div className="sbw-empty">暂无分集</div>
          ) : (
            <>
              <div className="sbw-episode-compact-list">
                {pageItems.map((episode) => {
                  const selected = episode.id === activeEpisodeId;
                  const production = productionByEpisodeId.get(episode.id);
                  const statusLabel = videoBatchStatusLabel(
                    production,
                    promptJobs?.[episode.id],
                  );
                  return (
                    <button
                      key={episode.id}
                      type="button"
                      className={`sbw-episode-compact${selected ? " is-selected" : ""}`}
                      disabled={switching}
                      onClick={() => onSelect(episode.id)}
                      title={`第${episode.episodeNumber}集 · ${statusLabel}`}
                      data-testid={`episode-sidebar-${episode.id}`}
                      data-prompt-status={resolveEpisodePromptGenDisplayStatus({
                        productionStatus: production?.status,
                        hasStoryboard: Boolean(production?.activeStoryboard),
                        job: promptJobs?.[episode.id],
                      })}
                      tabIndex={open ? 0 : -1}
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
                    tabIndex={open ? 0 : -1}
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
                    tabIndex={open ? 0 : -1}
                  >
                    下
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </aside>

      <button
        type="button"
        className="storyboard-episode-trigger sbw-episode-drawer__handle"
        data-testid="episode-sidebar-handle"
        aria-expanded={open}
        aria-controls="sbw-episode-drawer-panel"
        title={open ? "收起剧集列表" : "展开剧集列表"}
        onClick={handleToggle}
      >
        <span
          className="storyboard-episode-trigger__icon sbw-episode-drawer__handle-icon"
          aria-hidden
        >
          <List size={14} strokeWidth={2.25} />
        </span>
        <span className="storyboard-episode-trigger__label sbw-episode-drawer__handle-label">
          剧集列表
        </span>
      </button>
    </div>
  );
}
