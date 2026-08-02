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
};

/** List/avatar thumb: server URL or blob preview; falls back to category glyph. */
export function AssetListThumb({
  projectId,
  asset,
  placeholder,
  revision,
}: Props) {
  const src = resolveAssetImageSrc(projectId, asset, { revision });
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = !src || failedSrc === src;

  if (!src || failed) {
    return <>{placeholder}</>;
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
