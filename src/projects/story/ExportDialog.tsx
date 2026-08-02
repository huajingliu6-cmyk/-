"use client";

import { useChipBounce } from "@/shell/useChipBounce";
import type { GenerationHistoryItem } from "@/projects/story/types";

type Props = {
  open: boolean;
  items: GenerationHistoryItem[];
  selectedIds: string[];
  onClose: () => void;
  onToggle: (id: string) => void;
  onExport: () => void;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ExportDialog({
  open,
  items,
  selectedIds,
  onClose,
  onToggle,
  onExport,
}: Props) {
  const exportBounce = useChipBounce();
  if (!open) return null;

  const selected = new Set(selectedIds);

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
        aria-labelledby="scw-export-title"
      >
        <h3 id="scw-export-title">导出文本</h3>
        <p className="scw-dialog-desc">
          勾选历史文本后合并导出。本阶段仅 UI，不生成 Word。
        </p>
        <div className="scw-export-list">
          {items.map((item) => {
            const checked = selected.has(item.id);
            return (
              <label key={item.id} className="scw-export-item">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(item.id)}
                />
                <span>
                  <div className="scw-export-meta">
                    <span>版本{item.version}</span>
                    <span>{item.label}</span>
                    <span>{formatDate(item.createdAt)}</span>
                  </div>
                  <p className="scw-history-summary">{item.summary}</p>
                </span>
              </label>
            );
          })}
        </div>
        <div className="scw-dialog-actions">
          <button type="button" className="scw-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={`scw-btn scw-btn-primary ${exportBounce.bounceClass}`}
            disabled={selectedIds.length === 0}
            onClick={() => {
              exportBounce.trigger();
              onExport();
            }}
            onAnimationEnd={exportBounce.onAnimationEnd}
          >
            合并导出Word
          </button>
        </div>
      </div>
    </div>
  );
}
