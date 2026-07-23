"use client";

import Image from "next/image";
import { useRef, useState } from "react";
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

  const pick = () => inputRef.current?.click();

  const clear = () => {
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
        assetId: uploaded.assetId,
        assetUrl: uploaded.assetUrl,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        uploadStatus: "ready",
        errorMessage: "",
      });
    } catch (error) {
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

  return (
    <div className="nodrag nopan space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      {kind === "image" && assetUrl && uploadStatus === "ready" && (
        <div className="relative h-28 w-full overflow-hidden rounded-lg border border-zinc-700">
          <Image
            src={assetUrl}
            alt={fileName || "预览"}
            fill
            unoptimized
            className="object-cover"
            sizes="240px"
          />
        </div>
      )}

      {kind === "audio" && assetUrl && uploadStatus === "ready" && (
        <audio controls src={assetUrl} className="w-full" />
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
          {assetUrl ? "替换" : "上传"}
          {kind === "image" ? "图片" : "音频"}
        </button>
        {(assetUrl || uploadStatus === "error") && (
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
      {uploadStatus === "uploading" && (
        <div className="text-[11px] text-sky-300">上传中…</div>
      )}
      {errorMessage && (
        <div className="text-[11px] text-rose-300">{errorMessage}</div>
      )}
    </div>
  );
}
