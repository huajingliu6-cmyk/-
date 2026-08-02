"use client";

import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  shotLabel: string;
  blockers?: Array<{ shotLabel: string; message: string }>;
  mode?: "shot" | "episode";
  onCancel: () => void;
  onGoFix: () => void;
};

/** 场景未完成时的可关闭提醒；关闭后必须恢复页面可操作性 */
export function ShotSceneRequiredDialog({
  open,
  shotLabel,
  blockers,
  mode = "shot",
  onCancel,
  onGoFix,
}: Props) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="sbw-modal-backdrop"
      role="presentation"
      onClick={onCancel}
      data-testid="scene-required-dialog"
    >
      <div
        className="sbw-modal"
        role="dialog"
        aria-modal="true"
        aria-label="当前镜头尚未设置场景"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sbw-modal__head">
          <h3>
            {mode === "episode"
              ? "部分镜头尚未设置场景"
              : "当前镜头尚未设置场景"}
          </h3>
        </div>
        <div className="sbw-modal__body">
          {mode === "shot" ? (
            <p>
              请先从项目资产库添加场景，或将该场景需求标记为「此镜头无需独立资产」，再生成视频。
            </p>
          ) : (
            <>
              <p>以下镜头阻塞整集视频生成，请先处理后再提交：</p>
              <ul className="sbw-confirm-list">
                {(blockers ?? []).map((row) => (
                  <li key={row.shotLabel}>
                    {row.shotLabel}：{row.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {mode === "shot" ? (
            <p className="sbw-hint">镜头：{shotLabel}</p>
          ) : null}
        </div>
        <div className="sbw-modal__foot">
          <button type="button" className="sbw-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="sbw-btn sbw-btn-primary"
            onClick={onGoFix}
          >
            {mode === "episode" ? "去处理第一个镜头" : "去添加场景"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
