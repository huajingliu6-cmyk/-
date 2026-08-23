"use client";

import type { ImageJobPublic } from "@/projects/assets/image-generation/useLibraryImageGenerationJob";
import { getProjectAssetImageUrl } from "@/projects/assets/asset-image-url";

type Props = {
  projectId: string;
  context: "management" | "workspace";
  job: ImageJobPublic | null;
  fieldErrors?: Partial<Record<string, boolean>>;
  onRetry?: () => void;
  onRetrySave?: () => void;
  onRequestDeletePending?: () => void;
  onContinueWait?: () => void;
  onDismissTimeout?: () => void;
  onRedetectService?: () => void;
  onReplaceReferences?: (files: File[]) => void;
  needsReferenceReplace?: boolean;
  retrySnapshotIncomplete?: boolean;
  onOpenEditor?: () => void;
  timeoutDialogOpen?: boolean;
  deleteConfirmOpen?: boolean;
  onConfirmDeletePending?: () => void;
  onCancelDeletePending?: () => void;
  busyAction?: boolean;
  canRetry?: boolean;
  serviceNotice?: string;
  /** Library embedded host already shows the hero — hide terminal success card. */
  hideSucceededPreview?: boolean;
};

export function ImageGenerationTaskPanel({
  projectId,
  context,
  job,
  fieldErrors,
  onRetry,
  onRetrySave,
  onRequestDeletePending,
  onContinueWait,
  onDismissTimeout,
  onRedetectService,
  onReplaceReferences,
  needsReferenceReplace,
  retrySnapshotIncomplete,
  onOpenEditor,
  timeoutDialogOpen,
  deleteConfirmOpen,
  onConfirmDeletePending,
  onCancelDeletePending,
  busyAction,
  canRetry,
  serviceNotice,
  hideSucceededPreview = false,
}: Props) {
  if (!job && !timeoutDialogOpen && !deleteConfirmOpen) return null;
  if (!job) return null;

  // Library generate already linked — don't keep a floating result card over the detail image.
  if (
    (job.status === "succeeded" || job.status === "save_failed") &&
    job.savedToLibrary &&
    !timeoutDialogOpen &&
    !deleteConfirmOpen
  ) {
    return null;
  }

  // Embedded character/scene/prop prompt: hero owns the preview; a success card
  // below the textarea steals layout/scroll and feels like continuous flicker.
  if (
    hideSucceededPreview &&
    job.status === "succeeded" &&
    !timeoutDialogOpen &&
    !deleteConfirmOpen
  ) {
    return null;
  }

  const showProgress =
    job.status === "queued" ||
    job.status === "running" ||
    job.status === "saving" ||
    job.status === "timed_out_waiting";

  const showResult =
    (job.status === "succeeded" || job.status === "save_failed") &&
    job.primaryMediaId &&
    !job.savedToLibrary &&
    !(hideSucceededPreview && job.status === "succeeded");

  return (
    <div
      className="image-gen-task-panel"
      data-testid="image-gen-task-panel"
      data-status={job.status}
    >
      {showProgress ? (
        <div className="image-gen-task-panel__progress">
          <div className="image-gen-task-panel__stage">
            {job.stageLabel ?? "处理中"}
            {job.status === "queued" ? "（加载中…）" : null}
          </div>
          <div
            className="image-gen-task-panel__bar"
            role="progressbar"
            aria-valuenow={job.estimatedPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="预计进度"
          >
            <span style={{ width: `${job.estimatedPercent}%` }} />
          </div>
          <div className="image-gen-task-panel__percent">
            预计进度 {job.estimatedPercent}%
          </div>
        </div>
      ) : null}

      {showResult ? (
        <div className="image-gen-task-panel__result">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getProjectAssetImageUrl(projectId, job.primaryMediaId!, {
              revision: job.updatedAt,
              context,
            })}
            alt="生成结果"
            data-testid="image-gen-task-result"
          />
          {job.status === "save_failed" ? (
            <div className="image-gen-task-panel__save-failed">
              <p>{job.saveErrorMessage ?? job.errorMessage ?? "保存到资产库失败"}</p>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                data-testid="image-gen-retry-save"
                disabled={busyAction}
                onClick={onRetrySave}
              >
                重新保存到资产库
              </button>
              <button
                type="button"
                className="amw-btn"
                data-testid="image-gen-delete-pending"
                disabled={busyAction}
                onClick={onRequestDeletePending}
              >
                删除未入库结果
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {job.status === "failed" ? (
        <div className="image-gen-task-panel__error" data-testid="image-gen-task-error">
          <p data-error-code={job.errorCode ?? undefined}>
            {job.errorMessage ?? "生成失败"}
          </p>
          {serviceNotice ? (
            <p className="image-gen-task-panel__service-notice" role="status">
              {serviceNotice}
            </p>
          ) : null}
          {job.errorCode === "SERVICE_OFFLINE" ? (
            <div className="image-gen-task-panel__actions">
              <button
                type="button"
                className="amw-btn"
                data-testid="image-gen-redetect"
                disabled={busyAction}
                onClick={() => void onRedetectService?.()}
              >
                重新检测服务
              </button>
              <button
                type="button"
                className="amw-btn"
                data-testid="image-gen-retry-later"
                disabled={busyAction || !canRetry}
                onClick={onRetry}
              >
                稍后重试
              </button>
            </div>
          ) : null}
          {job.errorCode === "INVALID_PARAMS" ? (
            <p className="image-gen-task-panel__hint">
              请修正标红字段后重新生成（不提供一键重试）。
              {fieldErrors?.prompt ? " 提示词需修改。" : null}
              {fieldErrors?.referenceImages ? " 参考图需修改。" : null}
            </p>
          ) : null}
          {retrySnapshotIncomplete ? (
            <div
              className="image-gen-task-panel__legacy"
              data-testid="image-gen-retry-incomplete"
            >
              <p className="image-gen-task-panel__hint">
                旧任务缺少完整参数，请重新配置生成。
              </p>
              {onOpenEditor ? (
                <button
                  type="button"
                  className="amw-btn"
                  data-testid="image-gen-open-editor"
                  onClick={onOpenEditor}
                >
                  返回素材编辑
                </button>
              ) : null}
            </div>
          ) : null}
          {needsReferenceReplace || job.errorCode === "REFERENCE_IMAGE_REQUIRED" ? (
            <div className="image-gen-task-panel__replace-ref">
              <p className="image-gen-task-panel__hint">
                原参考图不可用。请重新选择参考图（将保留原提示词与其他参数）。
              </p>
              <label className="amw-btn">
                重新选择参考图
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  hidden
                  data-testid="image-gen-replace-ref"
                  disabled={busyAction}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (files.length) onReplaceReferences?.(files);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          ) : null}
          {job.errorCode !== "INVALID_PARAMS" &&
          job.errorCode !== "SERVICE_OFFLINE" &&
          job.errorCode !== "REFERENCE_IMAGE_REQUIRED" &&
          !retrySnapshotIncomplete &&
          canRetry ? (
            <button
              type="button"
              className="amw-btn amw-btn-primary"
              data-testid="image-gen-retry"
              disabled={busyAction}
              onClick={onRetry}
            >
              使用原参数重试
            </button>
          ) : null}
        </div>
      ) : null}

      {timeoutDialogOpen ? (
        <div className="amw-dialog-backdrop" role="dialog" aria-modal="true">
          <div className="amw-dialog" data-testid="image-gen-timeout-dialog">
            <h3>生成耗时较长</h3>
            <p>尚未收到最终结果。可继续等待 5 分钟，或等任务失败后再用原参数重试。</p>
            <div className="amw-dialog-actions">
              <button
                type="button"
                className="amw-btn"
                disabled={busyAction}
                onClick={onDismissTimeout}
              >
                关闭
              </button>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                data-testid="image-gen-continue-wait"
                disabled={busyAction}
                onClick={onContinueWait}
              >
                继续等待
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmOpen ? (
        <div className="amw-dialog-backdrop" role="dialog" aria-modal="true">
          <div className="amw-dialog" data-testid="image-gen-delete-confirm">
            <h3>删除未入库结果？</h3>
            <p>将删除本次生成的临时图片，不影响已入库资产。</p>
            <div className="amw-dialog-actions">
              <button
                type="button"
                className="amw-btn"
                disabled={busyAction}
                onClick={onCancelDeletePending}
              >
                取消
              </button>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                data-testid="image-gen-delete-confirm-btn"
                disabled={busyAction}
                onClick={onConfirmDeletePending}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

