"use client";

import { Play, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AudioAsset } from "@/projects/assets/types";
import { resolveVoicePreviewSrc } from "@/projects/assets/resolve-voice-preview-src";
import { useVoicePreviewPlayer } from "@/projects/assets/use-voice-preview-player";

type Props = {
  projectId: string;
  voiceId: string | null | undefined;
  audios?: AudioAsset[];
  /** Soft-disable look only; click still reports why preview is unavailable. */
  disabled?: boolean;
  className?: string;
  testId?: string;
  onStatus?: (message: string) => void;
  /**
   * iconOnly: two small buttons (legacy).
   * toggle: one large play/stop button for the compact voice bar.
   */
  iconOnly?: boolean;
  toggle?: boolean;
};

export function VoicePreviewButton({
  projectId,
  voiceId,
  audios = [],
  disabled = false,
  className = "amw-btn",
  testId,
  onStatus,
  iconOnly = false,
  toggle: toggleMode = false,
}: Props) {
  const { playing, error, setError, toggle, stop } = useVoicePreviewPlayer();
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const wasPlayingRef = useRef(false);
  const prevVoiceIdRef = useRef(voiceId);

  useEffect(() => {
    if (prevVoiceIdRef.current === voiceId) return;
    prevVoiceIdRef.current = voiceId;
    stop();
    setError("");
  }, [voiceId, stop, setError]);

  useEffect(() => {
    const notify = onStatusRef.current;
    if (!notify) return;
    if (error) {
      notify(error);
      wasPlayingRef.current = false;
      return;
    }
    if (playing) {
      notify("正在试听…");
      wasPlayingRef.current = true;
      return;
    }
    if (wasPlayingRef.current) {
      notify("");
      wasPlayingRef.current = false;
    }
  }, [playing, error]);

  const runToggle = () => {
    if (disabled) {
      const msg = "当前不可试听";
      setError(msg);
      onStatusRef.current?.(msg);
      return;
    }
    if (!voiceId) {
      const msg = "请先选择并绑定音色后再试听";
      setError(msg);
      onStatusRef.current?.(msg);
      return;
    }
    if (playing) {
      stop();
      onStatusRef.current?.("");
      return;
    }
    const resolved = resolveVoicePreviewSrc({
      projectId,
      voiceId,
      audios,
    });
    if (!resolved.ok) {
      setError(resolved.message);
      onStatusRef.current?.(resolved.message);
      return;
    }
    void toggle(resolved.src);
  };

  if (toggleMode) {
    return (
      <button
        type="button"
        className={`voice-preview-toggle${playing ? " is-playing" : ""} ${className}`.trim()}
        data-testid={testId ?? "voice-preview-toggle"}
        aria-disabled={!voiceId || disabled ? true : undefined}
        aria-pressed={playing}
        aria-label={playing ? "停止试听" : "试听音色"}
        title={
          !voiceId
            ? "请先选择并绑定音色后再试听"
            : playing
              ? "停止试听"
              : "试听音色"
        }
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          runToggle();
        }}
      >
        {playing ? (
          <Square size={22} aria-hidden fill="currentColor" />
        ) : (
          <Play size={24} aria-hidden fill="currentColor" />
        )}
      </button>
    );
  }

  return (
    <div
      className={`voice-preview-control${iconOnly ? " voice-preview-control--icon" : ""}`}
    >
      <button
        type="button"
        className={`${className}${playing ? " is-playing" : ""}${
          iconOnly ? " voice-preview-control__icon-btn" : ""
        }`}
        data-testid={testId}
        aria-disabled={!voiceId || disabled ? true : undefined}
        aria-pressed={playing}
        aria-label={playing ? "暂停试听" : "试听音色"}
        title={
          !voiceId
            ? "请先选择并绑定音色后再试听"
            : playing
              ? "暂停试听"
              : "试听音色"
        }
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          runToggle();
        }}
      >
        {iconOnly ? <Play size={16} aria-hidden /> : "试听"}
      </button>
      <button
        type="button"
        className={`${className}${
          iconOnly ? " voice-preview-control__icon-btn" : ""
        }`}
        disabled={!playing}
        aria-label="停止试听"
        title="停止试听"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          stop();
          onStatusRef.current?.("");
        }}
      >
        {iconOnly ? <Square size={14} aria-hidden /> : "停止"}
      </button>
    </div>
  );
}
