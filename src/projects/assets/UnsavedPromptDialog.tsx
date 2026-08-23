"use client";

type Props = {
  open: boolean;
  onSave: () => void | Promise<void>;
  onDiscard: () => void;
  onCancel: () => void;
  busy?: boolean;
};

export function UnsavedPromptDialog({
  open,
  onSave,
  onDiscard,
  onCancel,
  busy = false,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="character-unsaved-prompt-dialog"
      role="presentation"
      data-testid="unsaved-prompt-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="character-unsaved-prompt-dialog__card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-prompt-title"
      >
        <h3 id="unsaved-prompt-title">提示词尚未保存</h3>
        <p>是否保存当前提示词后再继续？</p>
        <div className="character-unsaved-prompt-dialog__actions">
          <button
            type="button"
            className="amw-btn amw-btn-primary"
            disabled={busy}
            data-testid="unsaved-prompt-save"
            onClick={() => void onSave()}
          >
            {busy ? "保存中…" : "保存"}
          </button>
          <button
            type="button"
            className="amw-btn"
            disabled={busy}
            data-testid="unsaved-prompt-discard"
            onClick={onDiscard}
          >
            不保存
          </button>
          <button
            type="button"
            className="amw-btn"
            disabled={busy}
            data-testid="unsaved-prompt-cancel"
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
