"use client";

import {
  ChevronDown,
  Expand,
  Film,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
  previewVideosByShotId?: Record<string, ShotVideoHistoryItem[]>;
};

type Clip = {
  shot: StoryboardShot;
  video: ShotVideoHistoryItem | null;
  start: number;
  duration: number;
};

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
  previewVideosByShotId,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const [latestVideos, setLatestVideos] = useState<
    Map<string, ShotVideoHistoryItem | null>
  >(() =>
    previewVideosByShotId
      ? new Map(
          shots.map((shot) => [
            shot.id,
            previewVideosByShotId[shot.id]?.[0] ?? null,
          ]),
        )
      : new Map(),
  );
  const [loading, setLoading] = useState(!previewVideosByShotId);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">(
    initialAspectRatio,
  );

  const historyKey = shots
    .map(
      (shot) =>
        `${shot.id}:${shot.lastGenerationId ?? ""}:${shot.videoHistoryGenerationIds.join(",")}`,
    )
    .join("|");

  useEffect(() => {
    if (previewVideosByShotId) return;
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
    previewVideosByShotId,
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
              disabled={loading || Boolean(previewVideosByShotId)}
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

        <div className="sbw-playback__shot-strip" role="list">
          {clips.map((clip, index) => (
            <button
              key={clip.shot.id}
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
          ))}
        </div>
      </section>
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
