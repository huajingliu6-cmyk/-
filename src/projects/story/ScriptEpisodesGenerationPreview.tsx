"use client";

import type { ScriptEpisodesGenerationDto } from "@/projects/script/script-episodes-generation-schema";

type Props = {
  open: boolean;
  rawText: string;
  parsed: ScriptEpisodesGenerationDto | null;
  parseError: string;
  statusLabel: string;
  displayModelName?: string;
  chargedPoints?: number;
  applying: boolean;
  hasExistingEpisodes: boolean;
  targetEpisodeNumber: number;
  errorNote?: string;
  onApply: () => void;
  onDiscard: () => void;
};

/**
 * Preview structured script episodes before applying to script-draft.
 * Plain text only — never HTML / Markdown rendering.
 */
export function ScriptEpisodesGenerationPreview({
  open,
  rawText,
  parsed,
  parseError,
  statusLabel,
  displayModelName,
  chargedPoints,
  applying,
  hasExistingEpisodes,
  targetEpisodeNumber,
  errorNote,
  onApply,
  onDiscard,
}: Props) {
  if (!open) return null;

  const ep = parsed?.episodes[0] ?? null;

  return (
    <div
      className="scw-gen-preview"
      role="dialog"
      aria-modal="true"
      aria-label="剧集生成结果预览"
      data-testid="script-episodes-preview"
    >
      <div className="scw-gen-preview__card">
        <header className="scw-gen-preview__head">
          <h2>剧集生成结果预览</h2>
          <p className="scw-gen-preview__meta">
            状态：{statusLabel}
            {displayModelName ? ` · 模型：${displayModelName}` : ""}
            {typeof chargedPoints === "number"
              ? ` · 本次积分：${chargedPoints}`
              : ""}
            {parsed
              ? ` · 生成 ${parsed.episodes.length} 集`
              : ""}
          </p>
        </header>

        {parseError ? (
          <div>
            <p className="scw-error" role="alert">
              {parseError}
            </p>
            <p className="scw-hint">原始输出（纯文本，可复制后重试生成）：</p>
            <textarea
              className="scw-textarea scw-gen-preview__text"
              readOnly
              value={rawText}
              aria-label="模型原始输出"
            />
          </div>
        ) : ep ? (
          <div>
            <p className="scw-hint">
              第 {ep.number} 集 · {ep.title} · {ep.content.length} 字符
            </p>
            <details open>
              <summary>展开正文预览</summary>
              <pre className="scw-gen-preview__text" style={{ whiteSpace: "pre-wrap" }}>
                {ep.content}
              </pre>
            </details>
          </div>
        ) : (
          <textarea
            className="scw-textarea scw-gen-preview__text"
            readOnly
            value={rawText}
            aria-label="生成中文本"
          />
        )}

        {errorNote ? (
          <p className="scw-error" role="alert">
            {errorNote}
          </p>
        ) : null}

        <p className="scw-hint">
          {hasExistingEpisodes
            ? `应用后将替换第 ${targetEpisodeNumber} 集，并使该集相关分镜进入过期状态。历史分镜和历史视频不会被删除。`
            : "确认应用后才会写入正式剧本；放弃不会修改当前剧集。"}
        </p>
        <div className="scw-btn-row">
          <button
            type="button"
            className="scw-btn"
            disabled={applying}
            onClick={onDiscard}
          >
            放弃本次结果
          </button>
          <button
            type="button"
            className="scw-btn scw-btn-primary"
            disabled={applying || !parsed}
            onClick={onApply}
            data-testid="script-episodes-apply"
          >
            {applying ? "应用中…" : "应用到正式剧本"}
          </button>
        </div>
      </div>
    </div>
  );
}
