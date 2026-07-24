"use client";

import Image from "next/image";
import type { CSSProperties } from "react";

export const BRAND_MARK_SRC = "/brand/mark.png";

type Props = {
  /** 显示尺寸（宽高相同） */
  size?: number;
  /** 加载等待时缓慢旋转 */
  spin?: boolean;
  className?: string;
  alt?: string;
  style?: CSSProperties;
};

/** 品牌四角标（透明底）：空素材占位 / 加载等待 */
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

type FrameProps = {
  size?: number;
  spin?: boolean;
  /** 可选极淡提示，默认不显示以保持干净 */
  label?: string;
  className?: string;
};

/** 预览区中央占位：只放 logo，留白呼吸感 */
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
