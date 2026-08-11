"use client";

import { useState, type ReactNode } from "react";
import { ImageOff } from "lucide-react";
import { DesignImageLightbox } from "@/projects/assets/DesignImageLightbox";

type Props = {
  src: string | null;
  alt: string;
  emptyIcon?: ReactNode;
  emptyLabel?: string;
  testId?: string;
  className?: string;
  /** Fill parent preview pane (library mid column). */
  fill?: boolean;
};

/** Shared detail image: contain, click-to-lightbox. */
export function AssetDetailImage({
  src,
  alt,
  emptyIcon,
  emptyLabel = "暂无图片",
  testId = "asset-detail-image",
  className = "",
  fill = false,
}: Props) {
  const [lightbox, setLightbox] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failKey, setFailKey] = useState(src ?? "");
  if (failKey !== (src ?? "")) {
    setFailKey(src ?? "");
    setFailed(false);
  }

  const showImage = Boolean(src) && !failed;

  return (
    <>
      <div
        className={`asset-detail-image${fill ? " asset-detail-image--fill" : " character-detail__image"}${
          className ? ` ${className}` : ""
        }`}
        data-testid={testId}
      >
        {showImage && src ? (
          <button
            type="button"
            className="asset-detail-image__hit"
            title="点击放大预览"
            onClick={() => setLightbox(true)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- project binary preview URL */}
            <img
              src={src}
              alt={alt}
              className="asset-detail-image__img"
              onError={() => setFailed(true)}
            />
          </button>
        ) : (
          <div className="asset-detail-image__empty" aria-hidden>
            {emptyIcon ?? <ImageOff size={28} strokeWidth={1.5} />}
            <span>{emptyLabel}</span>
          </div>
        )}
      </div>
      <DesignImageLightbox
        src={lightbox && showImage ? src : null}
        alt={alt}
        onClose={() => setLightbox(false)}
      />
    </>
  );
}
