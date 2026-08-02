"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useChipBounce } from "@/shell/useChipBounce";
import { EPISODES_PER_PAGE } from "@/projects/script/types";

export type EpisodePickItem = {
  id: string;
  episodeNumber: number;
  title?: string;
  wordCount?: number;
  statusLabel?: string;
};

type Props = {
  episodes: EpisodePickItem[];
  selectedId: string | null;
  page: number;
  /** 仅显示「第 N 集」可选列表（分集核对用） */
  numbersOnly?: boolean;
  emptyHint?: string;
  onSelect: (episodeId: string) => void;
  onPageChange: (page: number) => void;
};

export function ScriptProcessPanel({
  episodes,
  selectedId,
  page,
  numbersOnly = false,
  emptyHint = "请先上传剧本并点击「分集」。",
  onSelect,
  onPageChange,
}: Props) {
  const prevBounce = useChipBounce();
  const nextBounce = useChipBounce();

  const totalPages = Math.max(1, Math.ceil(episodes.length / EPISODES_PER_PAGE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * EPISODES_PER_PAGE;
    return episodes.slice(start, start + EPISODES_PER_PAGE);
  }, [episodes, safePage]);

  const rangeStart =
    episodes.length === 0 ? 0 : (safePage - 1) * EPISODES_PER_PAGE + 1;
  const rangeEnd = Math.min(safePage * EPISODES_PER_PAGE, episodes.length);

  return (
    <section className="scs-panel scs-panel--process" aria-label="剧本读取处理">
      <h2>剧本读取处理</h2>
      {episodes.length === 0 ? (
        <div className="scs-status-card">
          <div className="scs-status-label">分集列表</div>
          <div className="scs-status-value" style={{ fontSize: "1rem" }}>
            暂无分集
          </div>
          <p className="scs-hint">{emptyHint}</p>
        </div>
      ) : (
        <>
          <p className="scs-hint">
            {numbersOnly
              ? `共 ${episodes.length} 集 · 点击集数后在右侧查看正文`
              : `第 ${rangeStart}-${rangeEnd} 集 · 共 ${episodes.length} 集 · 每页最多 ${EPISODES_PER_PAGE} 集`}
          </p>
          <div
            className={`scs-episode-list${numbersOnly ? " is-numbers" : ""}`}
            role="listbox"
            aria-label="分集列表"
          >
            {pageItems.map((ep) => {
              const selected = ep.id === selectedId;
              return (
                <button
                  key={ep.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`scs-episode-pick${numbersOnly ? " is-number" : ""}${selected ? " is-selected" : ""}`}
                  onClick={() => onSelect(ep.id)}
                >
                  {numbersOnly ? (
                    <div className="scs-episode-pick__num">
                      第 {ep.episodeNumber} 集
                    </div>
                  ) : (
                    <>
                      <div className="scs-episode-pick__title">
                        {ep.title ?? `第${ep.episodeNumber}集`}
                      </div>
                      <div className="scs-episode-pick__meta">
                        <span>{ep.wordCount ?? 0} 字</span>
                        <span>{ep.statusLabel ?? "就绪"}</span>
                      </div>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          {totalPages > 1 ? (
            <div className="scs-pager" role="navigation" aria-label="分集翻页">
              <button
                type="button"
                className={`scs-pager__arrow ${prevBounce.bounceClass}`}
                disabled={safePage <= 1}
                aria-label="上一页"
                title="上一页"
                onClick={() => {
                  prevBounce.trigger();
                  onPageChange(safePage - 1);
                }}
                onAnimationEnd={prevBounce.onAnimationEnd}
              >
                <ChevronLeft size={14} strokeWidth={2.25} aria-hidden />
              </button>
              <span className="scs-pager__label">
                {safePage}/{totalPages}
              </span>
              <button
                type="button"
                className={`scs-pager__arrow ${nextBounce.bounceClass}`}
                disabled={safePage >= totalPages}
                aria-label="下一页"
                title="下一页"
                onClick={() => {
                  nextBounce.trigger();
                  onPageChange(safePage + 1);
                }}
                onAnimationEnd={nextBounce.onAnimationEnd}
              >
                <ChevronRight size={14} strokeWidth={2.25} aria-hidden />
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
