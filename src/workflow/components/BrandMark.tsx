"use client";

import Image from "next/image";
import type { CSSProperties } from "react";

export const BRAND_MARK_SRC = "/brand/mark.png";

type Props = {
  size?: number;
  spin?: boolean;
  className?: string;
  alt?: string;
  style?: CSSProperties;
};

export function BrandMark({
  size = 36,
  spin = false,
  className = "",
  alt = "",
  style,
}: Props) {
  return (
    <Image
      src={BRAND_MARK_SRC}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      unoptimized
      className={[
        "pointer-events-none select-none object-contain opacity-[0.92]",
        "[filter:drop-shadow(0_1px_1px_rgba(120,80,20,0.12))]",
        spin
          ? "animate-spin [animation-duration:2.4s] [animation-timing-function:linear]"
          : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ width: size, height: size, ...style }}
    />
  );
}

type MascotMarkProps = Omit<Props, "spin">;

export function MascotMark({
  size = 38,
  className = "",
  alt = "Lumina Story 创作精灵",
  style,
}: MascotMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label={alt}
      className={`pointer-events-none select-none ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      <defs>
        <linearGradient id="mark-gold" x1="10" y1="8" x2="54" y2="58">
          <stop stopColor="#fff4b7" />
          <stop offset=".48" stopColor="#e9b84e" />
          <stop offset="1" stopColor="#9d5f20" />
        </linearGradient>
        <linearGradient id="mark-face" x1="15" y1="15" x2="48" y2="53">
          <stop stopColor="#493329" />
          <stop offset="1" stopColor="#17131a" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="#18131a" stroke="url(#mark-gold)" strokeWidth="3" />
      <path d="M32 8C46 8 54 18 54 33C54 48 45 56 32 56C19 56 10 48 10 33C10 18 18 8 32 8Z" fill="url(#mark-face)" />
      <path d="M29 12V24L19 31M35 12V24L45 31M18 38H27L32 48L37 38H46" fill="none" stroke="url(#mark-gold)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="25" cy="33" rx="4.5" ry="6" fill="#fff8e8" />
      <ellipse cx="39" cy="33" rx="4.5" ry="6" fill="#fff8e8" />
      <circle cx="26" cy="34" r="2.2" fill="#9f6126" />
      <circle cx="38" cy="34" r="2.2" fill="#9f6126" />
      <path d="M28 42C31 45 34 45 37 42" fill="none" stroke="#ff9b79" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M32 2L34.5 7L40 8L36 12L37 17L32 14.5L27 17L28 12L24 8L29.5 7Z" fill="#ffe069" stroke="#fff4bd" strokeWidth="1" />
    </svg>
  );
}

type FrameProps = {
  size?: number;
  spin?: boolean;
  label?: string;
  className?: string;
};

export function BrandMarkFrame({
  size = 40,
  spin = false,
  label,
  className = "",
}: FrameProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2.5 ${className}`}
      title={label}
    >
      <BrandMark size={size} spin={spin} />
      {label ? (
        <span className="text-[9px] tracking-[0.14em] text-zinc-400/90">
          {label}
        </span>
      ) : null}
    </div>
  );
}
