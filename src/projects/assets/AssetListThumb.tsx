"use client";

import { useState } from "react";
import { resolveAssetImageSrc } from "@/projects/assets/asset-image-url";

type Props = {
  projectId: string;
  asset: {
    id: string;
    imageFileName: string | null;
    imageObjectUrl: string | null;
  };
  placeholder: string;
  revision?: string | number | null;
  /** Library/design cards use contain so the subject is not cropped. */
  fit?: "cover" | "contain";
  /** Sidebar row thumb — hide bulky empty copy. */
  compact?: boolean;
};

/** List/avatar thumb: server URL or blob preview; falls back to category glyph. */
export function AssetListThumb({
  projectId,
  asset,
  placeholder,
  revision,
  fit = "cover",
  compact = false,
}: Props) {
  const src = resolveAssetImageSrc(projectId, asset, { revision });
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = !src || failedSrc === src;

  if (!src || failed) {
    return (
      <span className={`asset-card__empty${compact ? " is-compact" : ""}`}>
        <span className="asset-card__empty-glyph">{placeholder}</span>
        {compact ? null : (
          <span className="asset-card__empty-label">暂无图片</span>
        )}
      </span>
    );
  }

  if (fit === "contain") {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- project binary preview URL */}
        <img
          className="asset-card__media-img"
          src={src}
          alt=""
          onError={() => setFailedSrc(src)}
        />
      </>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- probe only */}
      <img
        src={src}
        alt=""
        aria-hidden
        style={{ display: "none" }}
        onError={() => setFailedSrc(src)}
      />
      <span
        className="amw-avatar-thumb"
        style={{
          backgroundImage: `url(${JSON.stringify(src)})`,
        }}
      />
    </>
  );
}
