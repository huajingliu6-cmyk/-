"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  claimVoicePreview,
  releaseVoicePreview,
} from "@/projects/assets/voice-preview-bus";

/**
 * Per-button audio preview. Avoids shared-singleton races when many cards
 * mount/unmount or refresh after approval.
 */
export function useVoicePreviewPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const activeSrcRef = useRef<string | null>(null);

  const ensureAudio = useCallback(() => {
    if (typeof Audio === "undefined") {
      throw new Error("当前环境不支持音频播放");
    }
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audio.addEventListener("play", () => setPlaying(true));
      audio.addEventListener("playing", () => setPlaying(true));
      audio.addEventListener("pause", () => setPlaying(false));
      audio.addEventListener("ended", () => {
        setPlaying(false);
        activeSrcRef.current = null;
      });
      audio.addEventListener("error", () => {
        setPlaying(false);
        const code = audio.error?.code;
        const hint =
          code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? "浏览器不支持该音频格式"
            : code === MediaError.MEDIA_ERR_NETWORK
              ? "音频加载失败，请检查登录状态或文件是否存在"
              : "音频播放失败";
        setError(hint);
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      setPlaying(false);
      activeSrcRef.current = null;
      return;
    }
    audio.pause();
    audio.removeAttribute("src");
    try {
      audio.load();
    } catch {
      // ignore
    }
    activeSrcRef.current = null;
    setPlaying(false);
    releaseVoicePreview("voice-preview-player");
  }, []);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
      audioRef.current = null;
    };
  }, []);

  const toggle = useCallback(
    async (src: string | null | undefined) => {
      setError("");
      if (!src) {
        setError("请先选择音色");
        return;
      }

      try {
        const audio = ensureAudio();

        if (activeSrcRef.current === src && !audio.paused && !audio.ended) {
          audio.pause();
          setPlaying(false);
          return;
        }

        if (activeSrcRef.current === src && audio.paused && !audio.ended) {
          await audio.play();
          setPlaying(true);
          return;
        }

        activeSrcRef.current = src;
        audio.src = src;
        audio.currentTime = 0;
        claimVoicePreview("voice-preview-player", stop);
        await audio.play();
        setPlaying(true);
      } catch (err) {
        setPlaying(false);
        const message =
          err instanceof Error ? err.message : "浏览器无法播放该音色文件";
        // Autoplay / NotAllowedError still surface a useful hint
        setError(
          /NotAllowedError|interact/i.test(message)
            ? "浏览器拦截了自动播放，请再点一次试听"
            : message || "浏览器无法播放该音色文件",
        );
      }
    },
    [ensureAudio],
  );

  return { playing, error, setError, toggle, stop };
}
