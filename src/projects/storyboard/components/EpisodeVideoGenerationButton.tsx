"use client";

type Props = {
  enabled: boolean;
  disabledReason?: string;
  busy?: boolean;
  onClick: () => void;
};

/** 顶部「一键生成本集视频」；提示词未就绪时灰色禁用 */
export function EpisodeVideoGenerationButton({
  enabled,
  disabledReason,
  busy,
  onClick,
}: Props) {
  return (
    <button
      type="button"
      className={`sbw-btn${enabled ? " sbw-btn-primary" : " sbw-btn-muted"}`}
      data-testid="episode-generate-video-btn"
      disabled={!enabled || busy}
      title={!enabled ? disabledReason || "暂不可生成" : undefined}
      onClick={onClick}
    >
      {busy ? "提交中…" : "一键生成本集视频"}
    </button>
  );
}
