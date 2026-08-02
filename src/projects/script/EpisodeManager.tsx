"use client";

import { useId } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import {
  EPISODE_CHARS_DEFAULT,
  EPISODE_CHARS_MAX,
  EPISODE_CHARS_MIN,
  EPISODE_COUNT_MAX,
  EPISODE_COUNT_MIN,
  type EpisodeSplitConfig,
  type EpisodeSplitMode,
} from "@/projects/script/types";

type Props = {
  open: boolean;
  config: EpisodeSplitConfig;
  onClose: () => void;
  onChange: (next: EpisodeSplitConfig) => void;
  onConfirm: () => void;
};

const MODES: Array<{
  id: EpisodeSplitMode;
  title: string;
  desc: string;
}> = [
  {
    id: "by-episode-count",
    title: "按照剧本集数分集",
    desc: "指定总集数，系统按集数切分完整剧本",
  },
  {
    id: "by-chars",
    title: "按每集字数分集",
    desc: "指定单集字数，再结合总集数生成分集",
  },
];

export function EpisodeManager({
  open,
  config,
  onClose,
  onChange,
  onConfirm,
}: Props) {
  const epId = useId();
  const charsId = useId();
  const confirmBounce = useChipBounce();
  if (!open) return null;

  const byEpisodeCount = config.mode === "by-episode-count";

  const charsInvalid =
    !Number.isInteger(config.charsPerEpisode) ||
    config.charsPerEpisode < EPISODE_CHARS_MIN ||
    config.charsPerEpisode > EPISODE_CHARS_MAX;
  const countInvalid =
    !Number.isInteger(config.totalEpisodes) ||
    config.totalEpisodes < EPISODE_COUNT_MIN ||
    config.totalEpisodes > EPISODE_COUNT_MAX;

  const confirmDisabled = byEpisodeCount
    ? countInvalid
    : charsInvalid || countInvalid;

  return (
    <div
      className="scs-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="scs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scs-episode-title"
      >
        <h3 id="scs-episode-title">剧本分集设置</h3>
        <p className="scs-dialog-desc">
          选择分集方式并配置参数。本阶段仅 UI，不调用分集模型。
        </p>

        <p className="scs-section-title" style={{ marginTop: 0 }}>
          分集方式
        </p>
        <div className="scs-split-modes" role="radiogroup" aria-label="分集方式">
          {MODES.map((mode) => {
            const active = config.mode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`scs-split-mode${active ? " is-selected" : ""}`}
                onClick={() => onChange({ ...config, mode: mode.id })}
              >
                <span className="scs-split-mode__title">{mode.title}</span>
                <span className="scs-split-mode__desc">{mode.desc}</span>
              </button>
            );
          })}
        </div>

        <div className="scs-field">
          <label htmlFor={epId}>总集数</label>
          <input
            id={epId}
            className="scs-input"
            type="number"
            min={EPISODE_COUNT_MIN}
            max={EPISODE_COUNT_MAX}
            step={1}
            value={config.totalEpisodes}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(n)) return;
              onChange({
                ...config,
                totalEpisodes: Math.min(
                  EPISODE_COUNT_MAX,
                  Math.max(EPISODE_COUNT_MIN, n),
                ),
              });
            }}
          />
          {byEpisodeCount ? (
            <p className="scs-hint">
              按剧本集数分集时，以总集数为准切分。
            </p>
          ) : null}
        </div>

        <div className="scs-field">
          <label htmlFor={charsId}>每集字数</label>
          <input
            id={charsId}
            className="scs-input"
            type="number"
            min={EPISODE_CHARS_MIN}
            max={EPISODE_CHARS_MAX}
            step={1}
            disabled={byEpisodeCount}
            value={config.charsPerEpisode}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(n)) return;
              onChange({
                ...config,
                charsPerEpisode: Math.min(
                  EPISODE_CHARS_MAX,
                  Math.max(EPISODE_CHARS_MIN, n),
                ),
              });
            }}
          />
          <p className="scs-hint">
            {byEpisodeCount
              ? "按集数分集时，单集字数由剧本总长自动估算（本阶段 UI 冻结）。"
              : `范围 ${EPISODE_CHARS_MIN}-${EPISODE_CHARS_MAX}，默认 ${EPISODE_CHARS_DEFAULT}`}
          </p>
        </div>

        <div className="scs-dialog-actions">
          <button type="button" className="scs-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={`scs-btn scs-btn-primary ${confirmBounce.bounceClass}`}
            disabled={confirmDisabled}
            onClick={() => {
              confirmBounce.trigger();
              onConfirm();
            }}
            onAnimationEnd={confirmBounce.onAnimationEnd}
          >
            确认分集
          </button>
        </div>
      </div>
    </div>
  );
}
