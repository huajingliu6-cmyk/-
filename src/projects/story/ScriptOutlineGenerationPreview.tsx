"use client";

type Props = {
  open: boolean;
  text: string;
  statusLabel: string;
  displayModelName?: string;
  chargedPoints?: number;
  actualChars?: number;
  applying: boolean;
  hasExistingOutline: boolean;
  errorNote?: string;
  onApply: () => void;
  onDiscard: () => void;
};

/**
 * Preview generated script outline before applying to script-draft.outlineText.
 * Plain text only — never HTML.
 */
export function ScriptOutlineGenerationPreview({
  open,
  text,
  statusLabel,
  displayModelName,
  chargedPoints,
  actualChars,
  applying,
  hasExistingOutline,
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
      aria-label="剧本大纲生成结果预览"
      data-testid="script-outline-preview"
    >
      <div className="scw-gen-preview__card">
        <header className="scw-gen-preview__head">
          <h2>大纲生成结果预览</h2>
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
          aria-label="生成大纲正文"
        />
        {errorNote ? (
          <p className="scw-error" role="alert">
            {errorNote}
          </p>
        ) : null}
        <p className="scw-hint">
          {hasExistingOutline
            ? "应用后将替换当前大纲，但不会修改已导入剧本和分镜。"
            : "确认应用后才会写入剧本大纲；放弃不会修改当前大纲。正式剧本与分镜不会被改动。"}
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
            data-testid="script-outline-apply"
          >
            {applying ? "应用中…" : "应用到大纲"}
          </button>
        </div>
      </div>
    </div>
  );
}
