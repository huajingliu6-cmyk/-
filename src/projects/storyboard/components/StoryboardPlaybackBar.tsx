"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Expand,
  Film,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { fetchShotVideoHistory } from "@/projects/storyboard/api-client";
import type { StoryboardShot } from "@/projects/storyboard/types";
import type { ShotVideoHistoryItem } from "@/projects/storyboard/shot-video-history";

type Props = {
  projectId: string;
  episodeId: string;
  shots: StoryboardShot[];
  initialAspectRatio?: "16:9" | "9:16";
  workspaceMode?: boolean;
  selectedShotId?: string | null;
  onSelectShot?: (shotId: string) => void;
  onInsertShotAfter?: (shotId: string) => Promise<void> | void;
  insertShotBusyAfterId?: string | null;
  onDeleteShot?: (shotId: string) => Promise<void> | void;
  deleteShotBusyId?: string | null;
};

type Clip = {
  shot: StoryboardShot;
  video: ShotVideoHistoryItem | null;
  start: number;
  duration: number;
};

/** Workspace timeline: how many shot cards fit on one page. */
export const WORKSPACE_TIMELINE_PAGE_SIZE = 6;

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

async function loadLatestVideos(
  projectId: string,
  episodeId: string,
  shots: StoryboardShot[],
): Promise<Map<string, ShotVideoHistoryItem | null>> {
  const result = new Map<string, ShotVideoHistoryItem | null>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < shots.length) {
      const shot = shots[cursor++];
      try {
        const history = await fetchShotVideoHistory(projectId, episodeId, shot.id);
        result.set(shot.id, history.videos[0] ?? null);
      } catch {
        result.set(shot.id, null);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, shots.length) }, () => worker()),
  );
  return result;
}

export function StoryboardPlaybackBar({
  projectId,
  episodeId,
  shots,
  initialAspectRatio = "16:9",
  workspaceMode = false,
  selectedShotId = null,
  onSelectShot,
  onInsertShotAfter,
  insertShotBusyAfterId = null,
  onDeleteShot,
  deleteShotBusyId = null,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const [latestVideos, setLatestVideos] = useState<
    Map<string, ShotVideoHistoryItem | null>
  >(() => new Map());
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">(
    initialAspectRatio,
  );
  const [timelinePage, setTimelinePage] = useState(0);
  const [deleteConfirmShotId, setDeleteConfirmShotId] = useState<string | null>(
    null,
  );

  const canDeleteShot = shots.length > 1;
  const deleteConfirmShot = deleteConfirmShotId
    ? shots.find((shot) => shot.id === deleteConfirmShotId) ?? null
    : null;

  const historyKey = shots
    .map(
      (shot) =>
        `${shot.id}:${shot.lastGenerationId ?? ""}:${shot.videoHistoryGenerationIds.join(",")}`,
    )
    .join("|");

  useEffect(() => {
    let cancelled = false;
    void loadLatestVideos(projectId, episodeId, shots).then((videos) => {
      if (cancelled) return;
      setLatestVideos(videos);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    episodeId,
    historyKey,
    projectId,
    reloadToken,
    shots,
  ]);

  const clips = useMemo<Clip[]>(() => {
    return shots.map((shot, index) => {
      const duration = Math.max(0.1, shot.durationSeconds || 0.1);
      const start = shots.slice(0, index).reduce(
        (sum, item) => sum + Math.max(0.1, item.durationSeconds || 0.1),
        0,
      );
      return {
        shot,
        video: latestVideos.get(shot.id) ?? null,
        start,
        duration,
      };
    });
  }, [latestVideos, shots]);

  const totalDuration = clips.reduce(
    (sum, clip) => sum + clip.duration,
    0,
  );
  const activeClip = clips[activeIndex] ?? null;
  const playableCount = clips.filter((clip) => clip.video).length;
  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
  const timelinePageCount = Math.max(
    1,
    Math.ceil(clips.length / WORKSPACE_TIMELINE_PAGE_SIZE),
  );
  const safeTimelinePage = Math.min(timelinePage, timelinePageCount - 1);
  const timelinePageClips = useMemo(() => {
    const start = safeTimelinePage * WORKSPACE_TIMELINE_PAGE_SIZE;
    return clips
      .slice(start, start + WORKSPACE_TIMELINE_PAGE_SIZE)
      .map((clip, offset) => ({ clip, index: start + offset }));
  }, [clips, safeTimelinePage]);

  useEffect(() => {
    const selectedIndex = selectedShotId
      ? clips.findIndex((clip) => clip.shot.id === selectedShotId)
      : activeIndex;
    const index = selectedIndex >= 0 ? selectedIndex : activeIndex;
    if (index < 0) return;
    const page = Math.floor(index / WORKSPACE_TIMELINE_PAGE_SIZE);
    const timer = window.setTimeout(() => {
      setTimelinePage((current) => (current === page ? current : page));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeIndex, clips, selectedShotId]);

  const findPlayable = useCallback(
    (from: number, direction: 1 | -1) => {
      for (
        let index = from;
        index >= 0 && index < clips.length;
        index += direction
      ) {
        if (clips[index]?.video) return index;
      }
      return -1;
    },
    [clips],
  );

  const selectClip = useCallback(
    (index: number, localRatio = 0, autoplay = false) => {
      const clip = clips[index];
      if (!clip) return;
      setActiveIndex(index);
      onSelectShot?.(clip.shot.id);
      setCurrentTime(clip.start + clip.duration * localRatio);
      setAspectRatio(initialAspectRatio);
      pendingSeekRef.current = localRatio;
      if (autoplay) {
        setPreviewOpen(true);
        requestAnimationFrame(() => {
          void videoRef.current?.play().catch(() => setPlaying(false));
        });
      }
    },
    [clips, initialAspectRatio, onSelectShot],
  );

  const seekGlobal = useCallback(
    (nextTime: number) => {
      if (clips.length === 0) return;
      const bounded = Math.max(0, Math.min(nextTime, totalDuration));
      const index = Math.min(
        clips.length - 1,
        clips.findIndex(
          (clip) => bounded < clip.start + clip.duration,
        ) === -1
          ? clips.length - 1
          : clips.findIndex(
              (clip) => bounded < clip.start + clip.duration,
            ),
      );
      const clip = clips[index];
      const ratio = Math.max(
        0,
        Math.min(1, (bounded - clip.start) / clip.duration),
      );
      setCurrentTime(bounded);
      if (index !== activeIndex) {
        selectClip(index, ratio, playing && Boolean(clip.video));
        return;
      }
      const video = videoRef.current;
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = ratio * video.duration;
      } else {
        pendingSeekRef.current = ratio;
      }
    },
    [activeIndex, clips, playing, selectClip, totalDuration],
  );

  const moveClip = useCallback(
    (direction: 1 | -1) => {
      const index = findPlayable(activeIndex + direction, direction);
      if (index >= 0) selectClip(index, 0, playing);
    },
    [activeIndex, findPlayable, playing, selectClip],
  );

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!activeClip?.video) {
      const first = findPlayable(0, 1);
      if (first >= 0) selectClip(first, 0, true);
      return;
    }
    if (!workspaceMode) setPreviewOpen(true);
    if (video?.paused) void video.play();
    else video?.pause();
  }, [activeClip?.video, findPlayable, selectClip, workspaceMode]);

  const closePreview = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
    setPreviewOpen(false);
  }, []);

  const handleEnded = useCallback(() => {
    const next = findPlayable(activeIndex + 1, 1);
    if (next >= 0) {
      selectClip(next, 0, true);
    } else {
      setPlaying(false);
      setCurrentTime(totalDuration);
    }
  }, [activeIndex, findPlayable, selectClip, totalDuration]);

  const timelineStyle = {
    "--sbw-playback-progress": `${Math.max(0, Math.min(100, progress))}%`,
  } as CSSProperties;

  if (workspaceMode) {
    return (
      <>
      <section
        className="sbw-playback is-workspace-timeline"
        data-testid="storyboard-playback-bar"
        aria-label="分镜时间轴"
      >
        {activeClip?.video ? (
          <video
            key={activeClip.video.videoUrl}
            ref={videoRef}
            className="sbw-playback__hidden-player"
            src={activeClip.video.videoUrl}
            muted={muted}
            preload="metadata"
            playsInline
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              const ratio = pendingSeekRef.current;
              if (ratio != null && Number.isFinite(video.duration)) {
                video.currentTime = ratio * video.duration;
                pendingSeekRef.current = null;
              }
            }}
            onTimeUpdate={(event) => {
              const video = event.currentTarget;
              if (!activeClip || !Number.isFinite(video.duration) || video.duration <= 0)
                return;
              setCurrentTime(
                activeClip.start +
                  (video.currentTime / video.duration) * activeClip.duration,
              );
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={handleEnded}
          />
        ) : null}

        <div className="sbw-playback__workspace-head">
          <div className="sbw-playback__transport">
            <button
              type="button"
              className="sbw-playback__play"
              title={playing ? "暂停" : "播放"}
              aria-label={playing ? "暂停" : "播放"}
              disabled={playableCount === 0}
              onClick={togglePlayback}
            >
              {playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
            </button>
            <span className="sbw-playback__time">
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>
          </div>
          <div className="sbw-playback__tools">
            <span className="sbw-playback__count">
              {loading ? (
                <LoaderCircle className="is-spinning" size={15} />
              ) : (
                `${playableCount}/${clips.length}`
              )}
            </span>
            <button
              type="button"
              className="sbw-playback__icon-btn"
              title="刷新视频"
              aria-label="刷新视频"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setReloadToken((value) => value + 1);
              }}
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              className="sbw-playback__icon-btn"
              title={muted ? "打开声音" : "静音"}
              aria-label={muted ? "打开声音" : "静音"}
              onClick={() => setMuted((value) => !value)}
            >
              {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
          </div>
        </div>

        <div className="sbw-playback__workspace-timeline">
          {timelinePageCount > 1 ? (
            <button
              type="button"
              className="sbw-playback__page-btn"
              title="上一页"
              aria-label="上一页分镜"
              disabled={safeTimelinePage <= 0}
              onClick={() =>
                setTimelinePage((page) => Math.max(0, page - 1))
              }
            >
              <ChevronLeft size={18} />
            </button>
          ) : null}
          <div className="sbw-playback__shot-strip is-paged" role="list">
            {timelinePageClips.map(({ clip, index }, pageIndex) => (
              <div
                key={clip.shot.id}
                className="sbw-playback__shot-slot"
                role="listitem"
              >
                <button
                  type="button"
                  className={`sbw-playback__shot-card${
                    clip.shot.id === selectedShotId || index === activeIndex
                      ? " is-active"
                      : ""
                  }`}
                  onClick={() => selectClip(index)}
                  aria-label={`编辑镜头 ${String(clip.shot.shotNumber).padStart(2, "0")}`}
                >
                  <span className="sbw-playback__shot-number">
                    {String(clip.shot.shotNumber).padStart(2, "0")}
                  </span>
                  {onDeleteShot ? (
                    <span
                      className="sbw-playback__shot-delete"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="sbw-playback__shot-delete-btn"
                        title={
                          !canDeleteShot
                            ? "至少保留一个分镜"
                            : `删除镜头 ${String(clip.shot.shotNumber).padStart(2, "0")}`
                        }
                        aria-label={
                          !canDeleteShot
                            ? "至少保留一个分镜"
                            : `删除镜头 ${String(clip.shot.shotNumber).padStart(2, "0")}`
                        }
                        disabled={
                          !canDeleteShot || deleteShotBusyId !== null
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!canDeleteShot || deleteShotBusyId) return;
                          setDeleteConfirmShotId(clip.shot.id);
                        }}
                      >
                        {deleteShotBusyId === clip.shot.id ? (
                          <LoaderCircle size={12} className="animate-spin" />
                        ) : (
                          <X size={12} />
                        )}
                      </button>
                    </span>
                  ) : null}
                  <span className="sbw-playback__shot-frame">
                    {clip.video ? (
                      <video
                        src={clip.video.videoUrl}
                        muted
                        preload="metadata"
                        playsInline
                      />
                    ) : (
                      <span className="sbw-playback__shot-empty">
                        <Film size={21} />
                        {clip.shot.videoContentStale ? "待再次生成" : "待生成"}
                      </span>
                    )}
                  </span>
                  <span className="sbw-playback__shot-duration">
                    {clip.duration.toFixed(1)}s
                  </span>
                </button>
                {onInsertShotAfter &&
                pageIndex < timelinePageClips.length - 1 ? (
                  <button
                    type="button"
                    className="sbw-playback__insert-shot"
                    title={`在镜头 ${String(clip.shot.shotNumber).padStart(2, "0")} 后插入空白分镜`}
                    aria-label={`在镜头 ${String(clip.shot.shotNumber).padStart(2, "0")} 后插入空白分镜`}
                    disabled={insertShotBusyAfterId !== null}
                    onClick={(event) => {
                      event.stopPropagation();
                      void onInsertShotAfter(clip.shot.id);
                    }}
                  >
                    {insertShotBusyAfterId === clip.shot.id ? (
                      <LoaderCircle size={14} className="animate-spin" />
                    ) : (
                      <Plus size={14} />
                    )}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {timelinePageCount > 1 ? (
            <button
              type="button"
              className="sbw-playback__page-btn"
              title="下一页"
              aria-label="下一页分镜"
              disabled={safeTimelinePage >= timelinePageCount - 1}
              onClick={() =>
                setTimelinePage((page) =>
                  Math.min(timelinePageCount - 1, page + 1),
                )
              }
            >
              <ChevronRight size={18} />
            </button>
          ) : null}
        </div>
        {timelinePageCount > 1 ? (
          <p className="sbw-playback__page-hint">
            第 {safeTimelinePage + 1}/{timelinePageCount} 页 · 每页{" "}
            {WORKSPACE_TIMELINE_PAGE_SIZE} 个分镜
          </p>
        ) : null}
      </section>
      {deleteConfirmShot && typeof document !== "undefined"
        ? createPortal(
            <div
              className="sbw-dialog"
              role="presentation"
              data-testid="delete-shot-confirm"
              onClick={() => {
                if (deleteShotBusyId) return;
                setDeleteConfirmShotId(null);
              }}
            >
              <div
                className="sbw-dialog__card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-shot-title"
                onClick={(event) => event.stopPropagation()}
              >
                <h3 id="delete-shot-title">删除分镜</h3>
                <p>
                  确认删除“镜头{" "}
                  {String(deleteConfirmShot.shotNumber).padStart(2, "0")}
                  ”？删除后无法恢复。
                </p>
                <div className="sbw-dialog__footer">
                  <button
                    type="button"
                    className="sbw-btn"
                    disabled={deleteShotBusyId !== null}
                    onClick={() => setDeleteConfirmShotId(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="sbw-btn sbw-btn-danger"
                    disabled={deleteShotBusyId !== null}
                    onClick={() => {
                      const id = deleteConfirmShot.id;
                      void (async () => {
                        try {
                          await onDeleteShot?.(id);
                          setDeleteConfirmShotId(null);
                        } catch {
                          // Parent surfaces the error note; keep dialog open.
                        }
                      })();
                    }}
                  >
                    {deleteShotBusyId === deleteConfirmShot.id
                      ? "删除中…"
                      : "删除"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      </>
    );
  }

  return (
    <section
      className="sbw-playback"
      data-testid="storyboard-playback-bar"
      aria-label="整集视频预演"
    >
      {previewOpen ? (
        <div
          className={`sbw-playback__preview is-${aspectRatio.replace(":", "-")}`}
          data-aspect-ratio={aspectRatio}
        >
          <div className="sbw-playback__preview-head">
            <span>
              镜头 {String(activeClip?.shot.shotNumber ?? 0).padStart(2, "0")}
              <small>{aspectRatio}</small>
            </span>
            <button
              type="button"
              className="sbw-playback__icon-btn"
              title="收起预览"
              aria-label="收起预览"
              onClick={closePreview}
            >
              <ChevronDown size={17} />
            </button>
          </div>
          <div className="sbw-playback__stage">
            {activeClip?.video ? (
              <video
                key={activeClip.video.videoUrl}
                ref={videoRef}
                className="sbw-playback__video"
                src={activeClip.video.videoUrl}
                muted={muted}
                preload="metadata"
                playsInline
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  setAspectRatio(
                    video.videoHeight > video.videoWidth ? "9:16" : "16:9",
                  );
                  const ratio = pendingSeekRef.current;
                  if (ratio != null && Number.isFinite(video.duration)) {
                    video.currentTime = ratio * video.duration;
                    pendingSeekRef.current = null;
                  }
                }}
                onTimeUpdate={(event) => {
                  const video = event.currentTarget;
                  if (!activeClip || !Number.isFinite(video.duration) || video.duration <= 0)
                    return;
                  setCurrentTime(
                    activeClip.start +
                      (video.currentTime / video.duration) * activeClip.duration,
                  );
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={handleEnded}
              />
            ) : (
              <div className="sbw-playback__empty">
                <Film size={28} />
                <span>该镜头尚未生成视频</span>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="sbw-playback__transport">
        <button
          type="button"
          className="sbw-playback__icon-btn"
          title="上一镜"
          aria-label="上一镜"
          disabled={findPlayable(activeIndex - 1, -1) < 0}
          onClick={() => moveClip(-1)}
        >
          <SkipBack size={17} />
        </button>
        <button
          type="button"
          className="sbw-playback__play"
          title={playing ? "暂停" : "播放"}
          aria-label={playing ? "暂停" : "播放"}
          disabled={playableCount === 0}
          onClick={togglePlayback}
        >
          {playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
        </button>
        <button
          type="button"
          className="sbw-playback__icon-btn"
          title="下一镜"
          aria-label="下一镜"
          disabled={findPlayable(activeIndex + 1, 1) < 0}
          onClick={() => moveClip(1)}
        >
          <SkipForward size={17} />
        </button>
        <span className="sbw-playback__time">
          {formatTime(currentTime)} / {formatTime(totalDuration)}
        </span>
      </div>

      <div className="sbw-playback__timeline" style={timelineStyle}>
        <div className="sbw-playback__segments" aria-hidden>
          {clips.map((clip, index) => (
            <span
              key={clip.shot.id}
              className={`sbw-playback__segment${
                index === activeIndex ? " is-active" : ""
              }${clip.video ? " has-video" : " is-missing"}`}
              style={{ flexGrow: clip.duration }}
            >
              <b>{String(clip.shot.shotNumber).padStart(2, "0")}</b>
              <small>{clip.duration}s</small>
            </span>
          ))}
        </div>
        <div className="sbw-playback__progress" aria-hidden />
        <input
          type="range"
          min={0}
          max={Math.max(totalDuration, 0.1)}
          step={0.01}
          value={Math.min(currentTime, totalDuration)}
          aria-label="拖动整集播放进度"
          onChange={(event) => seekGlobal(Number(event.currentTarget.value))}
        />
      </div>

      <div className="sbw-playback__tools">
        <span className="sbw-playback__count">
          {loading ? (
            <LoaderCircle className="is-spinning" size={15} />
          ) : (
            `${playableCount}/${clips.length}`
          )}
        </span>
        <button
          type="button"
          className="sbw-playback__icon-btn"
          title="刷新视频"
          aria-label="刷新视频"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setReloadToken((value) => value + 1);
          }}
        >
          <RefreshCw size={16} />
        </button>
        <button
          type="button"
          className="sbw-playback__icon-btn"
          title={muted ? "打开声音" : "静音"}
          aria-label={muted ? "打开声音" : "静音"}
          onClick={() => setMuted((value) => !value)}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
        <button
          type="button"
          className="sbw-playback__icon-btn"
          title={previewOpen ? "收起预览" : "展开预览"}
          aria-label={previewOpen ? "收起预览" : "展开预览"}
          onClick={() => {
            if (previewOpen) closePreview();
            else setPreviewOpen(true);
          }}
        >
          <Film size={17} />
        </button>
        <button
          type="button"
          className="sbw-playback__icon-btn"
          title="全屏播放"
          aria-label="全屏播放"
          disabled={!activeClip?.video}
          onClick={() => {
            setPreviewOpen(true);
            void videoRef.current?.requestFullscreen?.();
          }}
        >
          <Expand size={17} />
        </button>
      </div>
    </section>
  );
}
