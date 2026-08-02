"use client";

import { Volume2 } from "lucide-react";
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
};

export function VoicePreviewButton({
  projectId,
  voiceId,
  audios = [],
  disabled = false,
  className = "amw-btn",
  testId,
  onStatus,
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

  return (
    <div className="voice-preview-control">
      <button
        type="button"
        className={`${className}${playing ? " is-playing" : ""}`}
        data-testid={testId}
        // Never use HTML disabled — it looks "unselectable" and swallows clicks.
        aria-disabled={!voiceId || disabled ? true : undefined}
        aria-pressed={playing}
        title={
          !voiceId
            ? "请先选择并绑定音色后再试听"
            : playing
              ? "暂停试听"
              : "试听"
        }
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
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
        }}
      >
        试听
      </button>
      {playing ? (
        <span className="voice-preview-speaker" aria-hidden title="播放中">
          <Volume2
            size={16}
            strokeWidth={2}
            className="voice-preview-speaker__icon"
          />
          <span className="voice-preview-speaker__wave voice-preview-speaker__wave--1" />
          <span className="voice-preview-speaker__wave voice-preview-speaker__wave--2" />
          <span className="voice-preview-speaker__wave voice-preview-speaker__wave--3" />
        </span>
      ) : null}
    </div>
  );
}
