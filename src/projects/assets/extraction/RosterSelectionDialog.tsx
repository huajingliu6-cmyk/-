"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicAssetRosterItem } from "@/projects/assets/extraction/types";

const TYPE_LABEL: Record<PublicAssetRosterItem["type"], string> = {
  character: "人物",
  scene: "场景",
  prop: "道具",
  audio: "音频",
};

const MATCH_LABEL: Record<PublicAssetRosterItem["matchStatus"], string> = {
  new: "新增候选",
  existing: "已存在",
  possible_duplicate: "疑似重复",
};

type Props = {
  open: boolean;
  episodeLabel?: string;
  roster: PublicAssetRosterItem[];
  submitting?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (selectedAssetKeys: string[]) => void | Promise<void>;
};

export function RosterSelectionDialog({
  open,
  episodeLabel,
  roster,
  submitting = false,
  error = null,
  onCancel,
  onConfirm,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setSelected(
      new Set(
        roster
          .filter((item) => item.defaultSelected && item.selectable)
          .map((item) => item.assetKey),
      ),
    );
  }, [open, roster]);

  const selectableCount = useMemo(
    () => roster.filter((item) => item.selectable).length,
    [roster],
  );

  if (!open) return null;

  const toggle = (item: PublicAssetRosterItem) => {
    if (!item.selectable || submitting) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.assetKey)) next.delete(item.assetKey);
      else next.add(item.assetKey);
      return next;
    });
  };

  const canSubmit = selected.size > 0 && !submitting;

  return (
    <div
      className="character-unsaved-prompt-dialog"
      role="dialog"
      aria-modal="true"
      data-testid="roster-selection-dialog"
    >
      <div className="character-unsaved-prompt-dialog__card roster-selection-dialog__card">
        <h3>本集新发现资产</h3>
        <p>
          {episodeLabel
            ? `${episodeLabel}：请选择要继续设计的资产。已存在资产默认不可选。`
            : "请选择要继续设计的资产。已存在资产默认不可选。"}
        </p>
        {selectableCount === 0 ? (
          <p className="roster-selection-dialog__empty">
            本集未发现可新增资产（名单均已存在于资产库）。
          </p>
        ) : null}
        <ul className="roster-selection-dialog__list" data-testid="roster-selection-list">
          {roster.map((item) => {
            const checked = selected.has(item.assetKey);
            return (
              <li
                key={item.assetKey}
                className="roster-selection-dialog__item"
                data-match={item.matchStatus}
              >
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!item.selectable || submitting}
                    onChange={() => toggle(item)}
                    data-testid={`roster-select-${item.assetKey}`}
                  />
                  <span className="roster-selection-dialog__meta">
                    <strong>{item.name}</strong>
                    <span>
                      {TYPE_LABEL[item.type]} · {MATCH_LABEL[item.matchStatus]}
                      {item.matchedAssetName
                        ? `（库内：${item.matchedAssetName}）`
                        : ""}
                    </span>
                    {item.aliases?.length ? (
                      <span>别名：{item.aliases.join("、")}</span>
                    ) : null}
                    {item.evidenceRefs?.length ? (
                      <span>出现：{item.evidenceRefs.slice(0, 3).join("；")}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {error ? (
          <p className="roster-selection-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="character-unsaved-prompt-dialog__actions">
          <button
            type="button"
            className="amw-btn amw-btn--ghost"
            onClick={onCancel}
            disabled={submitting}
            data-testid="roster-selection-cancel"
          >
            取消
          </button>
          <button
            type="button"
            className="amw-btn amw-btn--primary"
            disabled={!canSubmit}
            onClick={() => void onConfirm([...selected])}
            data-testid="roster-selection-confirm"
          >
            {submitting ? "提交中…" : "开始设计所选资产"}
          </button>
        </div>
      </div>
    </div>
  );
}
