"use client";

type Props = {
  src: string;
  alt: string;
  className?: string;
  /** cover：裁切填满；contain：完整可见（角色预览） */
  fit?: "cover" | "contain";
  /** 保留参数以兼容旧调用，画布缩略图不再依赖 sizes */
  sizes?: string;
};

/** 已成功解码过的 URL：节点选中/重挂载时直接显示，避免透明淡入闪烁 */
const decodedSrcCache = new Set<string>();

/**
 * 画布素材缩略图。使用原生 img：
 * - 避免 next/image 在 React Flow 选中/尺寸变化时重挂载闪白
 * - 已加载 URL 再次挂载时立即可见（不透明淡入）
 */
export function AssetThumb({
  src,
  alt,
  className = "",
  fit = "cover",
}: Props) {
  const alreadyDecoded = decodedSrcCache.has(src);
  const fitClass = fit === "contain" ? "object-contain" : "object-cover";

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      decoding={alreadyDecoded ? "sync" : "async"}
      loading={alreadyDecoded ? "eager" : "lazy"}
      className={`absolute inset-0 h-full w-full ${fitClass} ${className}`}
      style={alreadyDecoded ? undefined : { contentVisibility: "auto" }}
      onLoad={(e) => {
        decodedSrcCache.add(src);
        // 确保解码完成后仍保持不透明，避免二次绘制闪白
        e.currentTarget.style.opacity = "1";
      }}
    />
  );
}
