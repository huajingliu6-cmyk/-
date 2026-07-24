"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import type { AssetRecord } from "@/workflow/types";
import type { GenerationRecord } from "@/video-generation/types";
import {
  classifyGenerationResult,
  formatVideoFileSize,
} from "@/video-generation/classify-generation-result";
import { classifyVideoAspectRatio } from "@/video-generation/normalize-browser-metadata";
import { buildGeneratedVideoContentUrl } from "@/workflow/lib/generated-video-url";
import { VideoResultPlayer } from "@/workflow/components/VideoResultPlayer";

type Props = {
  open: boolean;
  onClose: () => void;
  generation: GenerationRecord | null;
  asset: AssetRecord | null;
  projectId: string;
  shotNumber?: number;
  onRetryTransfer?: () => void;
};

type BrowserMeta = {
  actualWidth: number;
  actualHeight: number;
  actualDurationSeconds: number;
  aspectRatioLabel: string;
};

function VideoResultDrawerBody({
  generation,
  asset,
  projectId,
  shotNumber,
  onRetryTransfer,
  onClose,
}: Omit<Props, "open">) {
  const [metaHint, setMetaHint] = useState<string | null>(null);
  const [browserMeta, setBrowserMeta] = useState<BrowserMeta | null>(null);

  const classified = classifyGenerationResult({ generation, asset });
  const videoAsset = classified.videoAsset;

  const actualWidth =
    browserMeta?.actualWidth ?? generation?.actualWidth ?? null;
  const actualHeight =
    browserMeta?.actualHeight ?? generation?.actualHeight ?? null;
  const actualDuration =
    browserMeta?.actualDurationSeconds ??
    generation?.actualDurationSeconds ??
    null;
  const aspectLabel =
    browserMeta?.aspectRatioLabel ??
    (actualWidth && actualHeight
      ? classifyVideoAspectRatio(actualWidth, actualHeight)
      : null);

  // 始终带上 projectId，避免仅依赖 generation.resultAsset 时播放失败
  const videoUrl =
    videoAsset && classified.canPlay
      ? buildGeneratedVideoContentUrl({
          assetId: videoAsset.id,
          generationId: generation?.id,
          projectId,
          shotNumber,
        })
      : null;

  const downloadUrl =
    videoAsset && classified.canDownload
      ? buildGeneratedVideoContentUrl({
          assetId: videoAsset.id,
          generationId: generation?.id,
          projectId,
          download: true,
          shotNumber,
        })
      : null;

  return (
    <>
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-zinc-900">视频结果</div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            {classified.label}
            {classified.isMock ? " · Mock" : ""}
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
          title="关闭"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 overflow-y-auto px-4 py-3">
        {classified.kind === "transferFailed" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            <div>{classified.message}</div>
            {onRetryTransfer && (
              <button
                type="button"
                className="mt-2 rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] text-amber-900"
                onClick={onRetryTransfer}
              >
                重试转存
              </button>
            )}
          </div>
        )}

        {classified.kind === "invalidVideoAsset" && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
            {classified.message}
          </div>
        )}

        {classified.canPlay && videoAsset && videoUrl ? (
          <VideoResultPlayer
            key={`${videoAsset.id}:${videoUrl}`}
            generationId={generation?.id ?? ""}
            videoAsset={videoAsset}
            isMock={classified.isMock}
            videoUrl={videoUrl}
            onMetadataUpdated={setBrowserMeta}
            onMetadataSaveError={setMetaHint}
          />
        ) : classified.kind !== "transferFailed" &&
          classified.kind !== "invalidVideoAsset" ? (
          <div className="flex h-40 items-center justify-center rounded-xl bg-zinc-100 text-[12px] text-zinc-500">
            {classified.message}
          </div>
        ) : null}

        {classified.isMock && classified.canPlay && (
          <div className="text-[11px] text-amber-800">
            Mock 演示视频，不是真实 AI 生成结果
          </div>
        )}

        {metaHint && (
          <div className="text-[11px] text-amber-700">{metaHint}</div>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
          <Row
            label="标识"
            value={classified.isMock ? "Mock" : "真实 Provider"}
          />
          <Row label="Provider" value={generation?.providerId ?? "—"} />
          <Row label="模型" value={generation?.providerModelId || "—"} />
          <Row
            label="镜头"
            value={typeof shotNumber === "number" ? String(shotNumber) : "—"}
          />
          <Row label="状态" value={generation?.status ?? classified.label} />
          <Row
            label="文件名"
            value={videoAsset?.originalFileName || videoAsset?.name || "—"}
          />
          <Row
            label="大小"
            value={
              videoAsset ? formatVideoFileSize(videoAsset.sizeBytes) : "—"
            }
          />
          <Row
            label="实际宽高"
            value={
              actualWidth && actualHeight
                ? `${actualWidth}×${actualHeight}`
                : "尚未读取"
            }
          />
          <Row
            label="实际时长"
            value={
              actualDuration != null
                ? `${actualDuration.toFixed(3)} 秒`
                : "尚未读取"
            }
          />
          <Row label="实际比例" value={aspectLabel ?? "尚未读取"} />
        </dl>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3">
        {downloadUrl ? (
          <a
            href={downloadUrl}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-800 hover:bg-zinc-50"
            download
          >
            <Download className="h-3.5 w-3.5" />
            下载 MP4
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-100 px-3 py-1.5 text-[12px] text-zinc-400"
          >
            <Download className="h-3.5 w-3.5" />
            无法下载
          </button>
        )}
        <button
          type="button"
          className="rounded-xl bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white"
          onClick={onClose}
        >
          关闭
        </button>
      </div>
    </>
  );
}

export function VideoResultDrawer({
  open,
  onClose,
  generation,
  asset,
  projectId,
  shotNumber,
  onRetryTransfer,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const bodyKey = `${generation?.id ?? "none"}:${asset?.id ?? "none"}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/55 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="视频结果"
      onMouseDown={onClose}
    >
      <div
        className="nodrag nopan nowheel flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <VideoResultDrawerBody
          key={bodyKey}
          generation={generation}
          asset={asset}
          projectId={projectId}
          shotNumber={shotNumber}
          onRetryTransfer={onRetryTransfer}
          onClose={onClose}
        />
      </div>
    </div>,
    document.body,
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-zinc-400">{label}</dt>
      <dd className="truncate font-medium text-zinc-800" title={value}>
        {value}
      </dd>
    </div>
  );
}
