"use client";

import { useEffect, useRef, useState } from "react";
import type { AssetRecord } from "@/workflow/types";
import { normalizeBrowserVideoMetadata } from "@/video-generation/normalize-browser-metadata";

type PlayerStatus =
  | "loading"
  | "ready"
  | "missing"
  | "unsupported"
  | "error";

type Props = {
  generationId: string;
  videoAsset: AssetRecord;
  isMock: boolean;
  videoUrl: string;
  posterUrl?: string | null;
  onMetadataUpdated?: (meta: {
    actualWidth: number;
    actualHeight: number;
    actualDurationSeconds: number;
    aspectRatioLabel: string;
  }) => void;
  onMetadataSaveError?: (message: string) => void;
};

function mapMediaError(
  code: number | undefined,
  hasAssetBytes: boolean,
): {
  status: PlayerStatus;
  message: string;
} {
  // MEDIA_ERR_DECODE(3) / MEDIA_ERR_SRC_NOT_SUPPORTED(4)
  if (code === 3 || code === 4) {
    return {
      status: "unsupported",
      message: hasAssetBytes
        ? "视频文件存在，但浏览器无法解码"
        : "当前浏览器不支持该视频格式",
    };
  }
  if (code === 2) {
    return { status: "missing", message: "视频文件不存在或无法访问" };
  }
  return {
    status: "error",
    message: hasAssetBytes
      ? "视频文件存在，但浏览器无法解码"
      : "视频加载失败，请稍后重试",
  };
}

export function VideoResultPlayer({
  generationId,
  videoAsset,
  isMock,
  videoUrl,
  posterUrl,
  onMetadataUpdated,
  onMetadataSaveError,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sentFingerprintRef = useRef<string>("");
  const onMetadataUpdatedRef = useRef(onMetadataUpdated);
  const onMetadataSaveErrorRef = useRef(onMetadataSaveError);

  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [statusMessage, setStatusMessage] = useState("正在读取视频…");

  useEffect(() => {
    onMetadataUpdatedRef.current = onMetadataUpdated;
    onMetadataSaveErrorRef.current = onMetadataSaveError;
  }, [onMetadataUpdated, onMetadataSaveError]);

  // 仅做超时与元数据请求取消；不要在 cleanup 里 strip src（Strict Mode 会拆掉
  // 正在加载的 <video>，表现为一直「正在读取视频…」）。
  useEffect(() => {
    sentFingerprintRef.current = "";
    abortRef.current?.abort();

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setStatus((current) => (current === "loading" ? "error" : current));
      setStatusMessage((current) =>
        current === "正在读取视频…"
          ? videoAsset.sizeBytes > 0
            ? "视频文件存在，但浏览器无法解码或加载超时"
            : "视频加载超时"
          : current,
      );
    }, 12_000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [videoUrl, videoAsset.id, videoAsset.sizeBytes]);

  const reportMetadata = async (
    width: number,
    height: number,
    duration: number,
  ) => {
    const normalized = normalizeBrowserVideoMetadata({
      width,
      height,
      duration,
    });
    if (!normalized.ok) {
      onMetadataSaveErrorRef.current?.(
        "视频可以播放，但元数据无效，未保存",
      );
      return;
    }

    const value = normalized.value;
    onMetadataUpdatedRef.current?.(value);

    const fingerprint = [
      videoAsset.id,
      value.actualWidth,
      value.actualHeight,
      value.actualDurationSeconds,
    ].join(":");

    if (sentFingerprintRef.current === fingerprint) {
      return;
    }

    if (!generationId) {
      sentFingerprintRef.current = fingerprint;
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/generations/${generationId}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          videoAssetId: videoAsset.id,
          actualWidth: value.actualWidth,
          actualHeight: value.actualHeight,
          actualDurationSeconds: value.actualDurationSeconds,
          metadataSource: "browser",
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        onMetadataSaveErrorRef.current?.(
          payload?.message
            ? `视频可以播放，但元数据保存失败：${payload.message}`
            : "视频可以播放，但元数据保存失败",
        );
        return;
      }
      sentFingerprintRef.current = fingerprint;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      onMetadataSaveErrorRef.current?.("视频可以播放，但元数据保存失败");
    }
  };

  return (
    <div className="nodrag nopan nowheel relative w-full overflow-hidden rounded-xl bg-zinc-950">
      {isMock && (
        <div className="absolute left-2 top-2 z-10 rounded-md bg-amber-500/95 px-2 py-0.5 text-[10px] font-medium text-zinc-900">
          Mock 演示视频，不是真实 AI 生成结果
        </div>
      )}

      <video
        ref={videoRef}
        className="nodrag nopan nowheel max-h-[min(52vh,420px)] w-full bg-black object-contain"
        controls
        preload="auto"
        playsInline
        poster={posterUrl || undefined}
        src={videoUrl}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onLoadStart={() => {
          setStatus("loading");
          setStatusMessage("正在读取视频…");
        }}
        onLoadedMetadata={(e) => {
          const video = e.currentTarget;
          setStatus("ready");
          setStatusMessage("视频可以播放");
          void reportMetadata(
            video.videoWidth,
            video.videoHeight,
            video.duration,
          );
        }}
        onLoadedData={() => {
          setStatus("ready");
          setStatusMessage("视频可以播放");
        }}
        onCanPlay={() => {
          setStatus("ready");
          setStatusMessage("视频可以播放");
        }}
        onError={(e) => {
          const code = e.currentTarget.error?.code;
          const mapped = mapMediaError(
            code,
            videoAsset.sizeBytes > 0,
          );
          setStatus(mapped.status);
          setStatusMessage(mapped.message);
        }}
      />

      {status !== "ready" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-zinc-950/80 px-3 py-2 text-[11px] text-zinc-200">
          {statusMessage}
        </div>
      )}
    </div>
  );
}
