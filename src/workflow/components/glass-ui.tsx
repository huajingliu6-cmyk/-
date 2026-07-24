import type { ButtonHTMLAttributes, ReactNode } from "react";
import { BrandMark } from "@/workflow/components/BrandMark";

/**
 * 节点浮层样式：半透明实色 + 轻阴影，避免 backdrop-blur 在重绘时闪烁。
 * （保留轻微玻璃感，但不做 2xl 级实时模糊合成）
 */
export const glass = {
  card:
    "rounded-[22px] border border-white/70 bg-[#f4f5f7]/92 shadow-[0_12px_40px_rgba(15,23,42,0.14)]",
  /** 选中仅叠加 ring，不改底色/阴影，避免选中时整卡重绘闪烁 */
  cardSelected:
    "rounded-[22px] border border-white/70 bg-[#f4f5f7]/92 shadow-[0_12px_40px_rgba(15,23,42,0.14)] ring-2 ring-sky-400/70",
  panel:
    "rounded-[20px] border border-white/70 bg-[#f3f4f6]/94 p-2.5 shadow-[0_16px_48px_rgba(15,23,42,0.16)]",
  floatBar:
    "flex w-max max-w-none shrink-0 items-center gap-1 rounded-full border border-white/70 bg-[#f5f6f8]/95 p-1.5 shadow-[0_12px_36px_rgba(15,23,42,0.14)]",
  actionDock:
    "nodrag nopan absolute inset-x-2 bottom-2 flex items-center justify-center gap-2 rounded-full border border-white/65 bg-[#f5f6f8]/90 px-2 py-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.12)]",
  iconBtn:
    "nodrag nopan inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/90 text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition hover:bg-white disabled:opacity-40",
  iconBtnActive:
    "nodrag nopan inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-300/80 bg-emerald-50 text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition disabled:opacity-40",
  chip:
    "nodrag nopan inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/80 bg-white/90 px-3.5 text-[12px] font-medium tracking-wide text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition hover:bg-white disabled:opacity-40",
  chipActive:
    "nodrag nopan inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-900/15 bg-zinc-900/90 px-3.5 text-[12px] font-medium tracking-wide text-white shadow-[0_4px_14px_rgba(15,23,42,0.2)] transition disabled:opacity-40",
  floatDivider: "mx-0.5 h-4 w-px shrink-0 bg-zinc-400/35",
  select:
    "nodrag nopan h-8 max-w-[7.25rem] truncate rounded-full border border-white/80 bg-white/90 px-2.5 text-[11px] text-zinc-700 outline-none transition hover:bg-white disabled:opacity-40",
  selectWrap:
    "nodrag nopan inline-flex h-8 items-center gap-1 rounded-full border border-white/80 bg-white/90 px-2 text-[11px] text-zinc-700",
  textarea:
    "min-h-[68px] w-full resize-none rounded-2xl border border-white/80 bg-white/95 px-3 py-2.5 text-[12px] leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-500 focus:border-zinc-300 focus:bg-white",
  send:
    "nodrag nopan inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-900/10 bg-zinc-900/90 text-white shadow-[0_6px_18px_rgba(15,23,42,0.25)] transition hover:bg-zinc-800 disabled:opacity-40",
  credit:
    "inline-flex h-8 min-w-[2rem] items-center justify-center rounded-full border border-white/80 bg-white/90 px-2 text-[11px] font-semibold tabular-nums text-zinc-700",
  popover:
    "rounded-2xl border border-white/70 bg-[#f5f6f8]/96 p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.16)]",
  status:
    "rounded-full border border-white/70 bg-white/85 px-2.5 py-0.5 text-center text-[10px] font-medium",
  handle:
    "!h-[18px] !w-[18px] !border-[1.5px] !border-white/90 !bg-zinc-700/85 !shadow-[0_2px_8px_rgba(0,0,0,0.2)]",
} as const;

type GlassIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  children: ReactNode;
};

export function GlassIconButton({
  active = false,
  className = "",
  children,
  ...props
}: GlassIconButtonProps) {
  return (
    <button
      type="button"
      className={`${active ? glass.iconBtnActive : glass.iconBtn} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

type GlassChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  children: ReactNode;
};

export function GlassChip({
  active = false,
  className = "",
  children,
  ...props
}: GlassChipProps) {
  return (
    <button
      type="button"
      className={`${active ? glass.chipActive : glass.chip} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

type GlassSendButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  busy?: boolean;
};

export function GlassSendButton({
  className = "",
  children,
  busy = false,
  disabled,
  ...props
}: GlassSendButtonProps) {
  return (
    <button
      type="button"
      className={`${glass.send} ${className}`}
      disabled={disabled || busy}
      {...props}
    >
      {busy ? <BrandMark size={15} spin /> : children}
    </button>
  );
}
