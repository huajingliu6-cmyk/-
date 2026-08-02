"use client";

import { createPortal } from "react-dom";
import { prefersReducedMotion } from "@/shell/login-portal";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** 统一离开确认（非原生 alert） */
export function ConfirmLeaveDialog({
  open,
  title,
  description,
  confirmLabel = "确认离开",
  cancelLabel = "继续编辑",
  onConfirm,
  onCancel,
}: Props) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[10px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-dialog-title"
        aria-describedby="leave-dialog-desc"
        className={`w-full max-w-md rounded-2xl border border-white/12 bg-[rgba(14,15,26,0.97)] p-5 text-white shadow-2xl ${
          prefersReducedMotion() ? "" : "animate-[pc-card-in_0.32s_ease-out]"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="leave-dialog-title" className="text-base font-semibold">
          {title}
        </h2>
        <p
          id="leave-dialog-desc"
          className="mt-2 text-sm leading-relaxed text-white/55"
        >
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="shell-chip shell-chip--glass h-10"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="shell-chip shell-chip--login h-10"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
