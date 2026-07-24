"use client";

import { useEffect, useRef, useState } from "react";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import { BrandMark } from "@/workflow/components/BrandMark";
import { StableAudioPlayer } from "@/workflow/components/StableAudioPlayer";
import { uploadAssetFile } from "@/workflow/lib/upload-asset";
import type { UploadStatus } from "@/workflow/types";

type AssetPatch = {
  assetId: string;
  assetUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadStatus: UploadStatus;
  errorMessage: string;
  duration?: number;
};

type Props = {
  kind: "image" | "audio";
  accept: string;
  assetUrl: string;
  fileName: string;
  uploadStatus: UploadStatus;
  errorMessage: string;
  onChange: (patch: AssetPatch) => void;
};

export function AssetUploadControls({
  kind,
  accept,
  assetUrl,
  fileName,
  uploadStatus,
  errorMessage,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const localPreviewRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreviewRef.current) {
        URL.revokeObjectURL(localPreviewRef.current);
      }
    };
  }, []);

  const pick = () => inputRef.current?.click();

  const clearLocalPreview = () => {
    if (localPreviewRef.current) {
      URL.revokeObjectURL(localPreviewRef.current);
      localPreviewRef.current = null;
    }
    setLocalPreview(null);
  };

  const clear = () => {
    clearLocalPreview();
    onChange({
      assetId: "",
      assetUrl: "",
      fileName: "",
      mimeType: "",
      sizeBytes: 0,
      uploadStatus: "empty",
      errorMessage: "",
      duration: 0,
    });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);

    if (kind === "image") {
      clearLocalPreview();
      const objectUrl = URL.createObjectURL(file);
      localPreviewRef.current = objectUrl;
      setLocalPreview(objectUrl);
    }

    onChange({
      assetId: "",
      assetUrl: "",
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      uploadStatus: "uploading",
      errorMessage: "",
    });

    try {
      const uploaded = await uploadAssetFile(file);
      onChange({
        assetId: uploaded.id,
        assetUrl: uploaded.url,
        fileName: uploaded.originalFileName,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        uploadStatus: "ready",
        errorMessage: "",
      });
      // 稍后再释放 blob，等服务端图接上，减少闪白
      window.setTimeout(() => clearLocalPreview(), 400);
    } catch (error) {
      clearLocalPreview();
      onChange({
        assetId: "",
        assetUrl: "",
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        uploadStatus: "error",
        errorMessage:
          error instanceof Error ? error.message : "上传失败，请重试",
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const previewSrc =
    uploadStatus === "ready" && assetUrl ? assetUrl : localPreview;

  return (
    <div className="nodrag nopan space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      {kind === "image" && previewSrc && (
        <div className="relative h-28 w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
          <AssetThumb
            src={previewSrc}
            alt={fileName || "预览"}
          />
          {busy || uploadStatus === "uploading" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/45">
              <BrandMark size={28} spin />
            </div>
          ) : null}
        </div>
      )}

      {kind === "image" && !previewSrc && (
        <div className="flex h-28 w-full items-center justify-center rounded-lg border border-dashed border-zinc-700/80 bg-zinc-950/70">
          <BrandMark
            size={28}
            spin={busy || uploadStatus === "uploading"}
          />
        </div>
      )}

      {kind === "audio" && assetUrl && uploadStatus === "ready" && (
        <StableAudioPlayer src={assetUrl} />
      )}

      {kind === "audio" && (busy || uploadStatus === "uploading") && (
        <div className="flex items-center justify-center py-3">
          <BrandMark size={22} spin />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-zinc-600 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-100"
          disabled={busy || uploadStatus === "uploading"}
          onClick={(e) => {
            e.stopPropagation();
            pick();
          }}
        >
          {assetUrl || localPreview ? "替换" : "上传"}
          {kind === "image" ? "图片" : "音频"}
        </button>
        {(assetUrl || localPreview || uploadStatus === "error") && (
          <button
            type="button"
            className="rounded-lg border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
          >
            清除
          </button>
        )}
      </div>

      {fileName && (
        <div className="truncate text-[11px] text-zinc-500">{fileName}</div>
      )}
      {errorMessage && (
        <div className="text-[11px] text-rose-300">{errorMessage}</div>
      )}
    </div>
  );
}
