"use client";

import type { ReactNode } from "react";

type Props = {
  enabled: boolean;
  hasSucceeded: boolean;
  contentStale?: boolean;
  failed?: boolean;
  disabledReason?: string;
  busy?: boolean;
  onClick: () => void;
  /** 画质 / 比例 / 时长等出参控件，放在生成按钮左侧空白区 */
  paramsSlot?: ReactNode;
};

/** 镜头卡片右下角生成入口（预览区不放置生成按钮） */
export function ShotVideoGenerationButton({
  enabled,
  hasSucceeded,
  contentStale,
  failed,
  disabledReason,
  busy,
  onClick,
  paramsSlot,
}: Props) {
  let label = "生成本分镜视频";
  if (contentStale || failed || hasSucceeded) label = "再次生成分镜视频";

  return (
    <div className="sbw-shot-video-actions">
      <div className="sbw-shot-video-actions__row">
        {paramsSlot ? (
          <div className="sbw-shot-video-actions__params">{paramsSlot}</div>
        ) : null}
        <button
          type="button"
          className={`sbw-btn${enabled ? " sbw-btn-primary" : " sbw-btn-muted"}`}
          disabled={!enabled || busy}
          title={!enabled ? disabledReason || "暂不可生成" : undefined}
          onClick={onClick}
          data-testid="generate-shot-storyboard-video"
        >
          {busy ? "提交中…" : label}
        </button>
      </div>
      {!enabled && disabledReason ? (
        <p className="sbw-hint sbw-shot-video-actions__hint">{disabledReason}</p>
      ) : null}
    </div>
  );
}
