"use client";

import { useMemo, useState } from "react";
import type { ShotVideoUiStatus } from "@/projects/storyboard/shot-video-status";
import type { ShotGenerationSnapshot } from "@/projects/storyboard/resolve-shot-video";
import {
  assignVersionLabels,
  listPlayableShotVideos,
  pageShotVideoHistory,
  SHOT_VIDEO_PREVIEW_PAGE_SIZE,
  type ShotVideoHistoryItem,
} from "@/projects/storyboard/shot-video-history";
import { classifyVideoProviderError } from "@/video-generation/user-facing-error";

type PendingPreviewSlot = {
  id: string;
  status: ShotVideoUiStatus;
  progress?: number | null;
  errorMessage?: string | null;
};

type Props = {
  status: ShotVideoUiStatus;
  progress?: number | null;
  errorMessage?: string | null;
  generation?: ShotGenerationSnapshot | null;
  contentStale?: boolean;
  projectId: string;
  historyVideos?: ShotVideoHistoryItem[];
  successGenerations?: ShotGenerationSnapshot[];
  /** Extra in-flight frames shown beside completed previews */
  pendingSlots?: PendingPreviewSlot[];
};

const STATUS_LABEL: Record<ShotVideoUiStatus, string> = {
  pending: "待生成",
  queued: "排队中",
  submitting: "提交中",
  processing: "生成中",
  completed: "生成成功",
  failed: "生成失败",
  stale: "内容已过期",
};

function mergeHistory(
  projectId: string,
  historyVideos: ShotVideoHistoryItem[],
  successGenerations: ShotGenerationSnapshot[],
): ShotVideoHistoryItem[] {
  const fromSuccess = listPlayableShotVideos({
    projectId,
    generations: successGenerations,
  });
  const map = new Map<string, ShotVideoHistoryItem>();
  for (const item of [...fromSuccess, ...historyVideos]) {
    if (!map.has(item.id)) map.set(item.id, item);
  }
  const merged = [...map.values()].sort((a, b) => {
    const ta = a.completedAt || "";
    const tb = b.completedAt || "";
    return tb.localeCompare(ta) || b.id.localeCompare(a.id);
  });
  return assignVersionLabels(merged);
}

/**
 * Remount via parent `key={videoUrl}` so a failed load cannot stick onto the
 * next history entry. Failure state lives only inside this leaf.
 */
function ShotVideoMedia({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="sbw-shot-preview__empty is-error">
        <p>视频加载失败</p>
        <p className="sbw-hint">可切换其他历史版本重试</p>
      </div>
    );
  }

  return (
    <video
      className="sbw-shot-preview__video"
      src={src}
      controls
      preload="metadata"
      playsInline
      onError={() => setFailed(true)}
    />
  );
}

function VideoFailureCopy({
  errorMessage,
}: {
  errorMessage?: string | null;
}) {
  const facing = classifyVideoProviderError(errorMessage);
  return (
    <>
      <p data-testid="shot-video-error-title">{facing.title}</p>
      <p
        className="sbw-shot-preview__error-detail"
        data-testid="shot-video-error-detail"
        data-error-kind={facing.kind}
      >
        {facing.message}
      </p>
    </>
  );
}

/** 镜头预览：最多同时展示 3 条成功视频，左右翻页查看历史；右上角下载 */
export function ShotVideoPreview({
  status,
  progress,
  errorMessage,
  generation,
  contentStale,
  projectId,
  historyVideos = [],
  successGenerations = [],
  pendingSlots = [],
}: Props) {
  const videos = useMemo(
    () => mergeHistory(projectId, historyVideos, successGenerations),
    [historyVideos, projectId, successGenerations],
  );

  /** User-requested start index; never clamped via effect — paging uses effectiveOffset. */
  const [requestedOffset, setRequestedOffset] = useState(0);
  const paged = pageShotVideoHistory(videos, requestedOffset);
  const effectiveOffset = paged.offset;

  const inFlight =
    status === "queued" || status === "submitting" || status === "processing";
  const activePending = pendingSlots.filter(
    (slot) =>
      slot.status === "queued" ||
      slot.status === "submitting" ||
      slot.status === "processing",
  );
  const showLegacyPending =
    activePending.length === 0 && paged.page.length === 0 && inFlight;

  const facingError =
    status === "failed" ? classifyVideoProviderError(errorMessage) : null;

  return (
    <section className="sbw-shot-preview" data-video-status={status}>
      <div className="sbw-shot-preview__head">
        <h4>镜头预览</h4>
        {videos.length > 0 || activePending.length > 0 ? (
          <span className="sbw-hint">
            共 {videos.length} 条
            {activePending.length > 0
              ? ` · 生成中 ${activePending.length}`
              : ""}
            {videos.length > SHOT_VIDEO_PREVIEW_PAGE_SIZE
              ? ` · 本页 ${paged.page.length}`
              : ""}
          </span>
        ) : null}
      </div>

      <div className="sbw-shot-preview__carousel">
        <button
          type="button"
          className="sbw-shot-preview__nav"
          aria-label="查看更新的视频"
          disabled={!paged.canPrev}
          onClick={() =>
            setRequestedOffset(
              Math.max(0, effectiveOffset - SHOT_VIDEO_PREVIEW_PAGE_SIZE),
            )
          }
        >
          ‹
        </button>

        <div className="sbw-shot-preview__strip">
          {activePending.map((slot) => (
            <div
              key={slot.id}
              className="sbw-shot-preview__card"
              data-testid="shot-preview-pending"
            >
              <div className="sbw-shot-preview__frame">
                <div className="sbw-shot-preview__empty is-loading">
                  <span className="sbw-shot-preview__spinner" aria-hidden />
                  <p>视频生成中，请稍候</p>
                  <p className="sbw-hint">
                    {STATUS_LABEL[slot.status] ?? "生成中"}
                  </p>
                  {typeof slot.progress === "number" &&
                  Number.isFinite(slot.progress) ? (
                    <p className="sbw-hint">{Math.round(slot.progress)}%</p>
                  ) : null}
                </div>
              </div>
            </div>
          ))}

          {showLegacyPending ? (
            <div className="sbw-shot-preview__card" data-testid="shot-preview-pending">
              <div className="sbw-shot-preview__frame">
                <div className="sbw-shot-preview__empty is-loading">
                  <span className="sbw-shot-preview__spinner" aria-hidden />
                  <p>视频生成中，请稍候</p>
                  <p className="sbw-hint">{STATUS_LABEL[status]}</p>
                  {typeof progress === "number" && Number.isFinite(progress) ? (
                    <p className="sbw-hint">{Math.round(progress)}%</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {paged.page.map((item) => (
            <div key={item.id} className="sbw-shot-preview__card">
              <div className="sbw-shot-preview__frame">
                <a
                  className="sbw-shot-preview__download"
                  href={item.downloadUrl}
                  download
                  title="下载视频"
                  aria-label="下载视频"
                >
                  下载
                </a>
                <ShotVideoMedia key={item.videoUrl} src={item.videoUrl} />
              </div>
              <p className="sbw-hint sbw-shot-preview__card-meta">
                <span className="sbw-shot-preview__version">
                  {item.versionLabel}
                </span>
                {item.sourceShotLabel ? (
                  <span className="sbw-shot-preview__archive">
                    {" "}
                    · {item.sourceShotLabel}
                  </span>
                ) : null}
                {item.isMock ? (
                  <span className="sbw-shot-preview__mock"> · Mock</span>
                ) : null}
                {item.completedAt
                  ? ` · ${new Date(item.completedAt).toLocaleString()}`
                  : ""}
              </p>
            </div>
          ))}

          {paged.page.length === 0 &&
          activePending.length === 0 &&
          !showLegacyPending &&
          !inFlight &&
          status === "failed" ? (
            <div
              className="sbw-shot-preview__card"
              data-testid="shot-preview-failed"
            >
              <div className="sbw-shot-preview__frame">
                <div className="sbw-shot-preview__empty is-error">
                  <VideoFailureCopy errorMessage={errorMessage} />
                </div>
              </div>
            </div>
          ) : null}

          {paged.page.length === 0 &&
          activePending.length === 0 &&
          !showLegacyPending &&
          !inFlight &&
          status !== "failed" ? (
            <div className="sbw-shot-preview__card">
              <div className="sbw-shot-preview__frame">
                <div className="sbw-shot-preview__empty">
                  <span className="sbw-shot-preview__icon" aria-hidden>
                    ▶
                  </span>
                  <p>本镜头尚未生成视频</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="sbw-shot-preview__nav"
          aria-label="查看更早的历史视频"
          disabled={!paged.canNext}
          onClick={() =>
            setRequestedOffset(effectiveOffset + SHOT_VIDEO_PREVIEW_PAGE_SIZE)
          }
        >
          ›
        </button>
      </div>

      <div className="sbw-shot-preview__meta">
        <span className="sbw-badge">{STATUS_LABEL[status]}</span>
        {contentStale || status === "stale" ? (
          <p className="sbw-hint">
            该视频基于旧版分镜生成，当前镜头内容已更新。
          </p>
        ) : null}
        {activePending.length > 0 && videos.length > 0 ? (
          <p className="sbw-hint">有新视频正在生成，完成后将出现在列表最前。</p>
        ) : null}
        {status === "failed" && facingError && videos.length > 0 ? (
          <p
            className="sbw-note is-error"
            data-testid="shot-video-error-note"
            data-error-kind={facingError.kind}
          >
            最近一次生成失败：{facingError.message}
            （仍可预览历史成功视频）
          </p>
        ) : null}
        {generation && status !== "pending" && videos.length === 0 && activePending.length === 0 ? (
          <p className="sbw-hint">
            {[
              generation.actualDurationSeconds != null
                ? `时长 ${generation.actualDurationSeconds}s`
                : null,
              generation.actualResolution || null,
              generation.providerModelId || null,
              generation.isMock ? "Mock 开发模式" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
