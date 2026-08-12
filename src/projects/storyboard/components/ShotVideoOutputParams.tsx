"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { GlassSelect } from "@/shell/glass-select";
import type { StoryboardVideoOutputParams } from "@/projects/storyboard/storyboard-video-params";
import {
  STORYBOARD_VIDEO_ASPECT_RATIOS,
  STORYBOARD_VIDEO_DURATION_MAX,
  STORYBOARD_VIDEO_DURATION_MIN,
  STORYBOARD_VIDEO_RESOLUTIONS,
  clampStoryboardVideoDuration,
} from "@/projects/storyboard/storyboard-video-params";
import {
  STORYBOARD_VIDEO_MODEL_CHOICES,
  STORYBOARD_VIDEO_STYLE_OPTIONS,
  type StoryboardVideoModelChoiceId,
  type StoryboardVideoStylePresetId,
} from "@/projects/storyboard/storyboard-video-model-choices";
import { estimateStoryboardVideoCredits } from "@/projects/storyboard/storyboard-video-constants";

type Props = {
  value: StoryboardVideoOutputParams;
  onChange: (next: StoryboardVideoOutputParams) => void;
  disabled?: boolean;
};

/**
 * 镜头视频出参：模型 → 画质 → 比例 → 风格 → 时长。
 * 所选值会随 generate-video 请求上送（模型为白名单 choice ID）。
 */
export function ShotVideoOutputParams({ value, onChange, disabled }: Props) {
  const durationPanelId = useId();
  const [durationOpen, setDurationOpen] = useState(false);
  const durationWrapRef = useRef<HTMLDivElement>(null);
  const [durationDraft, setDurationDraft] = useState(String(value.durationSeconds));
  const [syncedDuration, setSyncedDuration] = useState(value.durationSeconds);
  if (syncedDuration !== value.durationSeconds) {
    setSyncedDuration(value.durationSeconds);
    setDurationDraft(String(value.durationSeconds));
  }

  useEffect(() => {
    if (!durationOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = durationWrapRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setDurationOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDurationOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [durationOpen]);

  const commitDuration = (raw: number | string) => {
    const n = typeof raw === "number" ? raw : Number(raw);
    const next = clampStoryboardVideoDuration(n);
    setDurationDraft(String(next));
    if (next !== value.durationSeconds) {
      onChange({ ...value, durationSeconds: next });
    }
  };

  const creditEstimate = estimateStoryboardVideoCredits(
    value.durationSeconds,
    value.resolution,
  );

  return (
    <div
      className="sbw-shot-video-params"
      data-testid="shot-video-output-params"
    >
      <GlassSelect
        variant="compact"
        label="模型"
        hideLabel
        title="模型"
        value={value.modelChoice}
        disabled={disabled}
        options={STORYBOARD_VIDEO_MODEL_CHOICES.map((m) => ({
          id: m.id,
          label: m.label,
        }))}
        onChange={(id) => {
          onChange({
            ...value,
            modelChoice: id as StoryboardVideoModelChoiceId,
          });
        }}
        className="sbw-shot-video-params__select"
      />
      <GlassSelect
        variant="compact"
        label="画质"
        hideLabel
        title="画质"
        value={value.resolution}
        disabled={disabled}
        options={STORYBOARD_VIDEO_RESOLUTIONS.map((r) => ({
          id: r,
          label: r,
        }))}
        onChange={(id) => {
          if (id === "480P" || id === "720P" || id === "1080P") {
            onChange({ ...value, resolution: id });
          }
        }}
        className="sbw-shot-video-params__select"
      />
      <GlassSelect
        variant="compact"
        label="比例"
        hideLabel
        title="画幅比例"
        value={value.aspectRatio}
        disabled={disabled}
        options={STORYBOARD_VIDEO_ASPECT_RATIOS.map((r) => ({
          id: r,
          label: r,
        }))}
        onChange={(id) => {
          if (id === "16:9" || id === "9:16") {
            onChange({ ...value, aspectRatio: id });
          }
        }}
        className="sbw-shot-video-params__select"
      />
      <GlassSelect
        variant="compact"
        label="风格"
        hideLabel
        title="风格"
        value={value.stylePreset || "__default__"}
        disabled={disabled}
        options={STORYBOARD_VIDEO_STYLE_OPTIONS.map((s) => ({
          id: s.id || "__default__",
          label: s.label,
        }))}
        onChange={(id) => {
          const stylePreset = (
            id === "__default__" ? "" : id
          ) as StoryboardVideoStylePresetId;
          onChange({ ...value, stylePreset });
        }}
        className="sbw-shot-video-params__select"
      />

      <div className="sbw-shot-video-params__duration" ref={durationWrapRef}>
        <button
          type="button"
          className="sbw-shot-video-params__duration-trigger"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={durationOpen}
          aria-controls={durationPanelId}
          title="时长"
          data-testid="shot-video-duration-trigger"
          onClick={() => setDurationOpen((v) => !v)}
        >
          <span>{value.durationSeconds}s</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </button>
        {durationOpen ? (
          <div
            id={durationPanelId}
            className="sbw-shot-video-params__duration-panel"
            role="dialog"
            aria-label="选择时长"
          >
            <div className="sbw-shot-video-params__duration-row">
              <input
                type="range"
                min={STORYBOARD_VIDEO_DURATION_MIN}
                max={STORYBOARD_VIDEO_DURATION_MAX}
                step={1}
                value={value.durationSeconds}
                disabled={disabled}
                aria-label="时长滑条"
                data-testid="shot-video-duration-slider"
                onChange={(e) => commitDuration(e.target.value)}
              />
              <input
                type="number"
                min={STORYBOARD_VIDEO_DURATION_MIN}
                max={STORYBOARD_VIDEO_DURATION_MAX}
                step={1}
                value={durationDraft}
                disabled={disabled}
                aria-label="时长秒数"
                data-testid="shot-video-duration-input"
                className="sbw-shot-video-params__duration-input"
                onChange={(e) => setDurationDraft(e.target.value)}
                onBlur={() => commitDuration(durationDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitDuration(durationDraft);
                  }
                }}
              />
              <span className="sbw-shot-video-params__duration-unit">秒</span>
            </div>
            <p className="sbw-shot-video-params__duration-hint">
              {STORYBOARD_VIDEO_DURATION_MIN}–{STORYBOARD_VIDEO_DURATION_MAX} 秒
            </p>
          </div>
        ) : null}
      </div>
      <span
        className="sbw-shot-video-params__credit-estimate"
        data-testid="shot-video-credit-estimate"
        title="预计消耗积分（服务端将重新计价）"
      >
        {creditEstimate == null
          ? "积分未定价"
          : `预计 ${creditEstimate} 积分`}
      </span>
    </div>
  );
}
