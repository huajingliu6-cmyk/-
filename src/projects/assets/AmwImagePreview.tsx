"use client";

import { useState } from "react";

type Props = {
  src: string;
  alt: string;
  className?: string;
  /** Called when the image fails to load (e.g. GET 404). */
  onLoadError?: () => void;
};

/** Preview via background-image; probes load with a hidden img for 404 fallback. */
export function AmwImagePreview({
  src,
  alt,
  className = "",
  onLoadError,
}: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  if (failed || !src) {
    return null;
  }

  return (
    <div
      role="img"
      aria-label={alt}
      className={`amw-image-preview ${className}`.trim()}
      style={{
        backgroundImage: `url(${JSON.stringify(src)})`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- probe only */}
      <img
        src={src}
        alt=""
        aria-hidden
        style={{ display: "none" }}
        onError={() => {
          setFailedSrc(src);
          onLoadError?.();
        }}
      />
    </div>
  );
}
