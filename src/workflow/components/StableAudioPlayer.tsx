"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

type Props = {
  src: string;
  className?: string;
};

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function StableAudioPlayerInner({ src, className = "" }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = new Audio(src);
    audio.preload = "metadata";
    audioRef.current = audio;
    if (barRef.current) barRef.current.style.width = "0%";
    if (timeRef.current) timeRef.current.textContent = "0:00";

    const paint = () => {
      const duration = audio.duration || 0;
      const current = audio.currentTime || 0;
      if (barRef.current) {
        barRef.current.style.width =
          duration > 0 ? `${(current / duration) * 100}%` : "0%";
      }
      if (timeRef.current) {
        timeRef.current.textContent = formatTime(current);
      }
    };

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      paint();
    };

    audio.addEventListener("loadedmetadata", paint);
    audio.addEventListener("durationchange", paint);
    audio.addEventListener("timeupdate", paint);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", paint);
      audio.removeEventListener("durationchange", paint);
      audio.removeEventListener("timeupdate", paint);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.src = "";
      audioRef.current = null;
    };
  }, [src]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    audio.currentTime = ratio * audio.duration;
    if (barRef.current) barRef.current.style.width = `${ratio * 100}%`;
    if (timeRef.current) {
      timeRef.current.textContent = formatTime(audio.currentTime);
    }
  };

  return (
    <div
      className={`nodrag nopan nowheel flex h-9 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950/80 px-2 ${className}`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
        disabled={!src}
        title={playing ? "暂停" : "播放"}
        onClick={toggle}
      >
        {playing ? (
          <Pause className="h-3 w-3" fill="currentColor" />
        ) : (
          <Play className="h-3 w-3" fill="currentColor" />
        )}
      </button>
      <div
        className="relative h-1.5 min-w-0 flex-1 cursor-pointer rounded-full bg-zinc-700"
        title="跳转进度"
        onClick={seek}
      >
        <div
          ref={barRef}
          className="absolute inset-y-0 left-0 w-0 rounded-full bg-amber-400"
        />
      </div>
      <span
        ref={timeRef}
        className="w-8 shrink-0 text-right text-[10px] tabular-nums text-zinc-400"
      >
        0:00
      </span>
    </div>
  );
}

/**
 * 画布友好的音频播放器：
 * - 使用脱离节点 DOM 的 Audio 实例，避免原生 controls 在 React Flow transform 下整页闪烁
 * - src 变化时 remount，避免用 effect 同步 playing
 */
export function StableAudioPlayer({ src, className = "" }: Props) {
  return <StableAudioPlayerInner key={src} src={src} className={className} />;
}
