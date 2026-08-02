"use client";

import type { ShotVideoUiStatus } from "@/projects/storyboard/shot-video-status";
import { mapGenerationToUiStatus } from "@/projects/storyboard/shot-video-status";
import { formatVideoProviderErrorForUser } from "@/video-generation/user-facing-error";

export type { ShotVideoUiStatus };
export { mapGenerationToUiStatus };

const LABEL: Record<ShotVideoUiStatus, string> = {
  pending: "待生成",
  queued: "排队中",
  submitting: "提交中",
  processing: "生成中",
  completed: "生成成功",
  failed: "生成失败",
  stale: "内容已过期",
};

type Props = {
  status: ShotVideoUiStatus;
  progress?: number | null;
  errorMessage?: string | null;
  meta?: string | null;
  staleNotice?: boolean;
};

/** 紧凑状态条（底部操作区），完整预览见 ShotVideoPreview */
export function ShotGenerationStatus({
  status,
  progress,
  errorMessage,
  meta,
  staleNotice,
}: Props) {
  return (
    <div className={`sbw-video-status is-${status}`} data-video-status={status}>
      <div className="sbw-video-status__row">
        <span className="sbw-badge">{LABEL[status]}</span>
        {typeof progress === "number" && status === "processing" ? (
          <span className="sbw-hint">{Math.round(progress)}%</span>
        ) : null}
      </div>
      {staleNotice || status === "stale" ? (
        <p className="sbw-hint">
          该视频基于旧版分镜生成，当前镜头内容已更新。
        </p>
      ) : null}
      {errorMessage ? (
        <p className="sbw-note is-error" data-testid="shot-video-error-note">
          {formatVideoProviderErrorForUser(errorMessage)}
        </p>
      ) : null}
      {meta ? <p className="sbw-hint">{meta}</p> : null}
    </div>
  );
}
