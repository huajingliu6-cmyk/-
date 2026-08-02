"use client";

import type { GenerationHistoryItem } from "@/projects/story/types";

type Props = {
  open: boolean;
  items: GenerationHistoryItem[];
  onClose: () => void;
  onSelect: (item: GenerationHistoryItem) => void;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function GenerationHistoryPanel({
  open,
  items,
  onClose,
  onSelect,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="scw-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="scw-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scw-history-title"
      >
        <h3 id="scw-history-title">生成历史</h3>
        <p className="scw-dialog-desc">
          当前为 mock 数据，后续可对接真实生成记录接口。
        </p>
        <div className="scw-history-list">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="scw-history-item"
              onClick={() => onSelect(item)}
            >
              <div className="scw-history-meta">
                <span>版本{item.version}</span>
                <span>{item.label}</span>
                <span>{formatDate(item.createdAt)}</span>
              </div>
              <p className="scw-history-summary">{item.summary}</p>
            </button>
          ))}
        </div>
        <div className="scw-dialog-actions">
          <button type="button" className="scw-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
