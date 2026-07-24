"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { glass } from "@/workflow/components/glass-ui";

export const VIDEO_DURATION_MIN = 2;
export const VIDEO_DURATION_MAX = 15;

export function clampVideoDuration(
  value: number,
  min: number = VIDEO_DURATION_MIN,
  max: number = VIDEO_DURATION_MAX,
): number {
  if (!Number.isFinite(value)) return Math.min(max, Math.max(min, 5));
  return Math.min(max, Math.max(min, Math.round(value)));
}

type Props = {
  value: number;
  disabled?: boolean;
  onChange: (duration: number) => void;
  min?: number;
  max?: number;
  /** glass：节点浮层；dark：属性面板 */
  variant?: "glass" | "dark";
};

/** 时长：点击展开滑条 + 下方可输入秒数。业务值以 props.value 为准。 */
export function DurationCombobox({
  value,
  disabled = false,
  onChange,
  min = VIDEO_DURATION_MIN,
  max = VIDEO_DURATION_MAX,
  variant = "glass",
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  /** 仅编辑会话中的草稿；null 表示展示 store 中的值 */
  const [text, setText] = useState<string | null>(null);
  const duration = clampVideoDuration(value, min, max);
  const displayText = text ?? String(duration);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setOpen(false);
      setText(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setText(null);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  const apply = (nextRaw: number) => {
    const next = clampVideoDuration(nextRaw, min, max);
    setText(String(next));
    if (next !== clampVideoDuration(value, min, max)) {
      onChange(next);
    }
  };

  const commitText = (raw: string) => {
    apply(Number(raw));
  };

  const isDark = variant === "dark";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        title="视频时长"
        aria-expanded={open}
        className={
          isDark
            ? "inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 text-sm text-zinc-100 outline-none hover:border-zinc-500 disabled:opacity-40"
            : `${glass.select} inline-flex items-center gap-1 ${
                open ? "border-zinc-300 bg-white" : ""
              }`
        }
        onClick={() => {
          if (disabled) return;
          setOpen((v) => {
            const next = !v;
            if (next) setText(String(duration));
            else setText(null);
            return next;
          });
        }}
      >
        <span className="tabular-nums">{duration}s</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 opacity-60 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className={`nodrag nopan absolute left-0 top-[calc(100%+6px)] z-50 w-[220px] rounded-2xl p-3 shadow-[0_16px_40px_rgba(15,23,42,0.18)] ${
            isDark
              ? "border border-zinc-700 bg-zinc-900"
              : "border border-white/70 bg-white/95"
          }`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className={`mb-2.5 text-[12px] font-medium ${
              isDark ? "text-zinc-200" : "text-zinc-700"
            }`}
          >
            视频时长
          </div>

          <input
            type="range"
            min={min}
            max={max}
            step={1}
            value={duration}
            className={`nodrag nopan mb-3 h-1.5 w-full cursor-pointer ${
              isDark ? "accent-sky-400" : "accent-zinc-800"
            }`}
            onChange={(e) => apply(Number(e.target.value))}
          />

          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="number"
              min={min}
              max={max}
              step={1}
              value={displayText}
              className={`nodrag nopan h-9 w-full rounded-xl border px-2.5 text-[13px] tabular-nums outline-none ${
                isDark
                  ? "border-zinc-600 bg-zinc-950 text-zinc-100 focus:border-zinc-400"
                  : "border-zinc-200 bg-zinc-50 text-zinc-800 focus:border-zinc-400 focus:bg-white"
              }`}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => commitText(displayText)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitText(displayText);
                  setOpen(false);
                  setText(null);
                }
              }}
            />
            <span
              className={`shrink-0 text-[12px] ${
                isDark ? "text-zinc-400" : "text-zinc-500"
              }`}
            >
              秒
            </span>
          </div>
          <div
            className={`mt-1.5 text-[10px] ${
              isDark ? "text-zinc-500" : "text-zinc-400"
            }`}
          >
            可拖动或输入 {min}–{max}
          </div>
        </div>
      )}
    </div>
  );
}
