"use client";

type Props = {
  open: boolean;
  text: string;
  statusLabel: string;
  displayModelName?: string;
  chargedPoints?: number;
  actualChars?: number;
  applying: boolean;
  errorNote?: string;
  onApply: () => void;
  onDiscard: () => void;
};

/**
 * Preview generated story before applying to story-draft.
 * Renders plain text only (no HTML).
 */
export function StoryGenerationPreview({
  open,
  text,
  statusLabel,
  displayModelName,
  chargedPoints,
  actualChars,
  applying,
  errorNote,
  onApply,
  onDiscard,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="scw-gen-preview"
      role="dialog"
      aria-modal="true"
      aria-label="故事生成结果预览"
    >
      <div className="scw-gen-preview__card">
        <header className="scw-gen-preview__head">
          <h2>生成结果预览</h2>
          <p className="scw-gen-preview__meta">
            状态：{statusLabel}
            {displayModelName ? ` · 模型：${displayModelName}` : ""}
            {typeof chargedPoints === "number"
              ? ` · 本次积分：${chargedPoints}`
              : ""}
            {typeof actualChars === "number"
              ? ` · 字数：${actualChars}`
              : ""}
          </p>
        </header>
        <textarea
          className="scw-textarea scw-gen-preview__text"
          readOnly
          value={text}
          aria-label="生成故事正文"
        />
        {errorNote ? (
          <p className="scw-error" role="alert">
            {errorNote}
          </p>
        ) : null}
        <p className="scw-hint">
          确认应用后才会写入故事草稿；放弃不会修改当前草稿。
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
            disabled={applying || !text.trim()}
            onClick={onApply}
          >
            {applying ? "应用中…" : "应用到故事草稿"}
          </button>
        </div>
      </div>
    </div>
  );
}
