"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { GlassSelect } from "@/shell/glass-select";
import type {
  StoryboardVideoDefaults,
  StoryboardVideoOutputParams,
} from "@/projects/storyboard/storyboard-video-params";
import {
  STORYBOARD_VIDEO_ASPECT_RATIOS,
  STORYBOARD_VIDEO_DURATION_MAX,
  STORYBOARD_VIDEO_DURATION_MIN,
  STORYBOARD_VIDEO_RESOLUTIONS,
  clampStoryboardVideoDuration,
  defaultStoryboardVideoDefaults,
  defaultStoryboardVideoOutputParams,
} from "@/projects/storyboard/storyboard-video-params";
import {
  STORYBOARD_VIDEO_MODEL_CHOICES,
  STORYBOARD_VIDEO_STYLE_OPTIONS,
  type StoryboardVideoModelChoiceId,
  type StoryboardVideoStylePresetId,
} from "@/projects/storyboard/storyboard-video-model-choices";
import { estimateStoryboardVideoCredits } from "@/projects/storyboard/storyboard-video-constants";

type Mode = "all" | "defaults" | "duration";

type FullProps = {
  mode?: "all" | "duration";
  value: StoryboardVideoOutputParams;
  onChange: (next: StoryboardVideoOutputParams) => void;
  disabled?: boolean;
};

type DefaultsProps = {
  mode: "defaults";
  value: StoryboardVideoDefaults;
  onChange: (next: StoryboardVideoDefaults) => void;
  disabled?: boolean;
};

type Props = FullProps | DefaultsProps;

function DefaultsSelects({
  value,
  onChange,
  disabled,
}: {
  value: StoryboardVideoDefaults;
  onChange: (next: StoryboardVideoDefaults) => void;
  disabled?: boolean;
}) {
  return (
    <>
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
    </>
  );
}

function DurationControls({
  value,
  onChange,
  disabled,
}: {
  value: StoryboardVideoOutputParams;
  onChange: (next: StoryboardVideoOutputParams) => void;
  disabled?: boolean;
}) {
  const durationPanelId = useId();
  const [durationOpen, setDurationOpen] = useState(false);
  const [durationDraft, setDurationDraft] = useState(
    String(value.durationSeconds),
  );
  const durationWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDurationDraft(String(value.durationSeconds));
  }, [value.durationSeconds]);

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

  const commitDuration = (seconds: number) => {
    const next = clampStoryboardVideoDuration(seconds);
    if (next !== value.durationSeconds) {
      onChange({ ...value, durationSeconds: next });
    }
    setDurationDraft(String(next));
  };

  const creditEstimate = estimateStoryboardVideoCredits(
    value.durationSeconds,
    value.resolution,
  );

  return (
    <>
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
            <label className="sbw-shot-video-params__duration-row">
              <span className="sbw-shot-video-params__duration-unit">
                {STORYBOARD_VIDEO_DURATION_MIN}–{STORYBOARD_VIDEO_DURATION_MAX}s
              </span>
              <input
                type="range"
                min={STORYBOARD_VIDEO_DURATION_MIN}
                max={STORYBOARD_VIDEO_DURATION_MAX}
                step={1}
                value={value.durationSeconds}
                disabled={disabled}
                data-testid="shot-video-duration-slider"
                aria-label="视频时长拉条"
                onChange={(event) =>
                  commitDuration(Number(event.target.value))
                }
              />
              <input
                type="number"
                className="sbw-shot-video-params__duration-input"
                min={STORYBOARD_VIDEO_DURATION_MIN}
                max={STORYBOARD_VIDEO_DURATION_MAX}
                value={durationDraft}
                disabled={disabled}
                data-testid="shot-video-duration-input"
                aria-label="视频时长秒数"
                onChange={(event) => {
                  setDurationDraft(event.target.value);
                  const parsed = Number(event.target.value);
                  if (Number.isFinite(parsed)) {
                    commitDuration(parsed);
                  }
                }}
                onBlur={() => {
                  commitDuration(Number(durationDraft));
                }}
              />
              <span className="sbw-shot-video-params__duration-unit">秒</span>
            </label>
            <p className="sbw-shot-video-params__duration-hint">
              生成视频时长可选 {STORYBOARD_VIDEO_DURATION_MIN}–
              {STORYBOARD_VIDEO_DURATION_MAX} 秒
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
    </>
  );
}

/**
 * 视频出参控件。
 * - defaults：右上角全局默认（模型 / 画质 / 比例 / 风格）
 * - duration：镜头旁时长拉条
 * - all：完整控件（兼容）
 */
export function ShotVideoOutputParams(props: Props) {
  const disabled = props.disabled;

  if (props.mode === "defaults") {
    const value = props.value ?? defaultStoryboardVideoDefaults();
    return (
      <div
        className="sbw-shot-video-params sbw-shot-video-params--header"
        data-testid="shot-video-output-params"
      >
        <DefaultsSelects
          value={value}
          onChange={props.onChange}
          disabled={disabled}
        />
      </div>
    );
  }

  const mode: Mode = props.mode ?? "all";
  const value =
    props.value ?? defaultStoryboardVideoOutputParams(undefined, null);
  const onChange = props.onChange;

  return (
    <div
      className="sbw-shot-video-params"
      data-testid="shot-video-output-params"
    >
      {mode === "all" ? (
        <DefaultsSelects
          value={{
            resolution: value.resolution,
            aspectRatio: value.aspectRatio,
            modelChoice: value.modelChoice,
            stylePreset: value.stylePreset,
          }}
          onChange={(next) => onChange({ ...value, ...next })}
          disabled={disabled}
        />
      ) : null}
      <DurationControls
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}
