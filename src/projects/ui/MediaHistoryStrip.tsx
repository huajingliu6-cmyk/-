"use client";

import { useMemo, useState } from "react";

export type MediaHistoryItem = {
  id: string;
  thumbUrl: string;
  title?: string;
  isPrimary?: boolean;
};

type Props = {
  items: MediaHistoryItem[];
  activeId: string | null;
  onSelect?: (id: string) => void;
  disabled?: boolean;
  maxVisible?: number;
  forceShow?: boolean;
  testId?: string;
  className?: string;
};

const DEFAULT_MAX = 6;

export function MediaHistoryStrip({
  items,
  activeId,
  onSelect,
  disabled = false,
  maxVisible = DEFAULT_MAX,
  forceShow = false,
  testId = "media-history-strip",
  className = "",
}: Props) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(Math.max(items.length, 1) / maxVisible));

  const safePage = Math.min(page, pageCount - 1);
  const windowItems = items.slice(
    safePage * maxVisible,
    safePage * maxVisible + maxVisible,
  );

  const activeIndexInWindow = useMemo(() => {
    if (!activeId) return -1;
    return windowItems.findIndex((item) => item.id === activeId);
  }, [activeId, windowItems]);

  const counterLabel = (() => {
    if (items.length === 0) return `0/${maxVisible}`;
    if (activeIndexInWindow >= 0) {
      return `${safePage * maxVisible + activeIndexInWindow + 1}/${maxVisible}`;
    }
    return `0/${maxVisible}`;
  })();

  if (!forceShow && items.length <= 1) return null;

  return (
    <div
      className={`media-history-strip ${className}`.trim()}
      data-testid={testId}
    >
      {pageCount > 1 ? (
        <button
          type="button"
          className="media-history-strip__pager"
          disabled={safePage <= 0}
          aria-label="上一页"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          ‹
        </button>
      ) : null}
      <div
        className="media-history-strip__grid"
        data-testid={`${testId}-grid`}
      >
        {windowItems.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              className={`media-history-strip__thumb${active ? " is-active" : ""}`}
              disabled={disabled || !onSelect}
              title={item.title ?? item.id}
              data-testid={`${testId}-thumb-${item.id}`}
              onClick={() => onSelect?.(item.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.thumbUrl} alt="" />
            </button>
          );
        })}
        {Array.from(
          { length: Math.max(0, maxVisible - windowItems.length) },
          (_, index) => (
            <div
              key={`empty-${index}`}
              className="media-history-strip__thumb is-empty"
              aria-hidden
            />
          ),
        )}
      </div>
      {pageCount > 1 ? (
        <button
          type="button"
          className="media-history-strip__pager"
          disabled={safePage >= pageCount - 1}
          aria-label="下一页"
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
        >
          ›
        </button>
      ) : null}
      <span className="media-history-strip__counter" data-testid={`${testId}-counter`}>
        {counterLabel}
      </span>
    </div>
  );
}
