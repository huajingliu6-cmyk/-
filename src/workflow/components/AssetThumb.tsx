"use client";

import Image from "next/image";

type Props = {
  src: string;
  alt: string;
  className?: string;
  /** cover：裁切填满；contain：完整可见（角色预览） */
  fit?: "cover" | "contain";
  /** 传给 next/image 的 sizes，帮助布局估算 */
  sizes?: string;
};

/** 已成功解码过的 URL：节点选中/重挂载时直接显示，避免透明淡入闪烁 */
const decodedSrcCache = new Set<string>();

/**
 * 画布素材缩略图（next/image + unoptimized）：
 * - 支持 /api/assets、本地静态与动态 URL
 * - 已加载 URL 再次挂载时使用 priority，减少闪白
 */
export function AssetThumb({
  src,
  alt,
  className = "",
  fit = "cover",
  sizes = "160px",
}: Props) {
  const alreadyDecoded = decodedSrcCache.has(src);
  const fitClass = fit === "contain" ? "object-contain" : "object-cover";

  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      sizes={sizes}
      draggable={false}
      priority={alreadyDecoded}
      className={`${fitClass} ${className}`}
      style={alreadyDecoded ? undefined : { contentVisibility: "auto" }}
      onLoad={() => {
        decodedSrcCache.add(src);
      }}
    />
  );
}
