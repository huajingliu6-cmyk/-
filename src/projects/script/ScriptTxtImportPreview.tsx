"use client";

import type { ScriptImportApiResponse } from "@/projects/script/script-txt-client";

type Props = {
  preview: ScriptImportApiResponse;
  replacing: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ScriptImportPreview({
  preview,
  replacing,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const formatLabel =
    preview.format === "docx"
      ? "DOCX（Office Open XML）"
      : preview.format === "md"
        ? "Markdown"
        : "TXT";

  return (
    <div
      className="scs-txt-preview"
      role="dialog"
      aria-modal="true"
      aria-label="剧本解析预览"
    >
      <div className="scs-txt-preview__panel">
        <h3>解析预览</h3>
        <dl className="scs-txt-preview__meta">
          <div>
            <dt>文件名</dt>
            <dd>{preview.fileName}</dd>
          </div>
          <div>
            <dt>格式</dt>
            <dd>{formatLabel}</dd>
          </div>
          {(preview.format === "txt" || preview.format === "md") &&
          preview.encoding ? (
            <div>
              <dt>编码</dt>
              <dd>{preview.encoding}</dd>
            </div>
          ) : null}
          <div>
            <dt>大小</dt>
            <dd>{formatBytes(preview.byteLength)}</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd className="scs-txt-preview__hash">{preview.sha256}</dd>
          </div>
          <div>
            <dt>字符数</dt>
            <dd>{preview.characterCount}</dd>
          </div>
          <div>
            <dt>集数</dt>
            <dd>{preview.episodeCount}</dd>
          </div>
        </dl>

        {preview.warnings.length > 0 ? (
          <ul className="scs-txt-preview__warnings">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}

        {replacing ? (
          <p className="scs-txt-preview__caution" role="status">
            确认后将替换当前剧本；已确认的分镜可能失效，操作完成后需要重新确认剧本。
          </p>
        ) : null}

        <ol className="scs-txt-preview__episodes">
          {preview.episodes.map((ep, index) => (
            <li key={ep.id}>
              <strong>
                #{index + 1} · 集号 {ep.episodeNumber} · {ep.title}
              </strong>
              <span>{ep.wordCount} 字</span>
            </li>
          ))}
        </ol>

        <div className="scs-btn-row">
          <button
            type="button"
            className="scs-btn"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="scs-btn scs-btn-primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy
              ? "保存中…"
              : replacing
                ? "替换当前剧本"
                : "确认导入"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** @deprecated Prefer ScriptImportPreview */
export const ScriptTxtImportPreview = ScriptImportPreview;
