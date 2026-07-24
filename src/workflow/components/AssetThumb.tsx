"use client";

import { memo } from "react";

type Props = {
  src: string;
  alt: string;
  className?: string;
  /** cover 填满；contain 完整可见 */
  fit?: "cover" | "contain";
};

/** 画布缩略图：CSS background，避免 React Flow 重绘时 img 按原图像素闪一下 */
function AssetThumbInner({
  src,
  alt,
  className = "",
  fit = "cover",
}: Props) {
  return (
    <div
      role="img"
      aria-label={alt}
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      style={{
        backgroundImage: `url(${JSON.stringify(src)})`,
        backgroundSize: fit === "contain" ? "contain" : "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        contain: "paint",
      }}
    />
  );
}

export const AssetThumb = memo(AssetThumbInner);
