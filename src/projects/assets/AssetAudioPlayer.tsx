"use client";

import { useEffect, useRef, useState } from "react";
import { resolveAssetAudioSrc } from "@/projects/assets/asset-audio-url";

type Props = {
  projectId: string;
  assetId: string;
  fileName: string | null;
  objectUrl: string | null;
  revision?: number;
  onError?: () => void;
};

/**
 * Durable audio player: blob preview while uploading, else authorized GET URL.
 * Reloads when revision / src changes so replace does not keep a stale cache.
 */
export function AssetAudioPlayer({
  projectId,
  assetId,
  fileName,
  objectUrl,
  revision = 0,
  onError,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const src = resolveAssetAudioSrc(
    projectId,
    { id: assetId, fileName, objectUrl },
    { revision },
  );
  const srcKey = `${src ?? ""}:${revision}`;
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const failed = failedKey === srcKey;

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !src) return;
    el.load();
  }, [src, revision]);

  if (!src || failed) {
    return (
      <p className="amw-hint" data-testid="asset-audio-empty">
        未上传音频
      </p>
    );
  }

  return (
    <audio
      ref={audioRef}
      key={`${assetId}-${revision}-${src.startsWith("blob:") ? "blob" : "server"}`}
      className="amw-audio-player"
      controls
      src={src}
      preload="metadata"
      data-testid="asset-audio-player"
      data-audio-src={src.startsWith("blob:") ? "blob" : "server"}
      onError={() => {
        setFailedKey(srcKey);
        onError?.();
      }}
    >
      浏览器不支持音频播放
    </audio>
  );
}
