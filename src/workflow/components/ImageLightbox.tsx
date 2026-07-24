"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type Props = {
  src: string | null;
  alt?: string;
  onClose: () => void;
};

/** 全屏放大预览：挂到 body，关闭键贴在图片右上角 */
export function ImageLightbox({ src, alt = "预览", onClose }: Props) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, onClose]);

  if (!src || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onMouseDown={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="relative w-fit max-w-[min(920px,92vw)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="block max-h-[90vh] max-w-full rounded-xl object-contain shadow-2xl"
        />
        <button
          type="button"
          className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-zinc-900/80 text-white shadow-md transition hover:bg-zinc-800"
          title="关闭"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
