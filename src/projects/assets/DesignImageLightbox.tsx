"use client";

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type Props = {
  src: string | null;
  alt?: string;
  onClose: () => void;
};

/**
 * Design-surface image lightbox: fade + soft scale, Esc / backdrop / close.
 * Uses plain <img> so blob: preview URLs work.
 */
export function DesignImageLightbox({
  src,
  alt = "放大预览",
  onClose,
}: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!src) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [src, onClose]);

  if (!src || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ead-lightbox"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="design-image-lightbox"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => {
        // Portal events still bubble through the React tree; stop so the
        // design modal backdrop does not receive this as a close click.
        e.stopPropagation();
      }}
    >
      <p id={titleId} className="sr-only">
        {alt}
      </p>
      <div
        className="ead-lightbox__stage"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- blob / project preview URL */}
        <img className="ead-lightbox__img" src={src} alt={alt} draggable={false} />
        <button
          type="button"
          className="ead-lightbox__close"
          title="关闭预览"
          aria-label="关闭预览"
          data-testid="design-image-lightbox-close"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
