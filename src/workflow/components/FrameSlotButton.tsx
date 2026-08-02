"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import { glass } from "@/workflow/components/glass-ui";
import { useAssetById } from "@/workflow/hooks/useAssetById";
import { uploadAssetFile } from "@/workflow/lib/upload-asset";
import type { AssetRecord } from "@/workflow/types";

type Props = {
  label: string;
  assetId: string;
  projectId: string;
  disabled?: boolean;
  title?: string;
  /** 来自连线解析的只读预览（节点字段为空时仍可显示） */
  previewUrl?: string | null;
  previewLocked?: boolean;
  onChange: (assetId: string, uploadedAsset?: AssetRecord) => void;
  onUploadError?: (message: string) => void;
};

export function FrameSlotButton({
  label,
  assetId,
  projectId,
  disabled = false,
  title,
  previewUrl,
  previewLocked = false,
  onChange,
  onUploadError,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const asset = useAssetById(assetId || null);
  const thumb =
    asset?.thumbnailUrl ||
    asset?.url ||
    (previewUrl && !assetId ? previewUrl : null);
  const hasFrame = Boolean(assetId || previewUrl);

  const onUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadAssetFile(file, {
        assetType: "referenceImage",
        projectId,
        name: file.name,
      });
      onChange(uploaded.id, uploaded);
    } catch (error) {
      onUploadError?.(
        error instanceof Error ? error.message : "上传失败，请重试",
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div
      className={`${glass.selectWrap} gap-1.5 pr-1`}
      title={title || label}
    >
      <span className="shrink-0 text-[10px] text-zinc-500">{label}</span>
      <button
        type="button"
        disabled={disabled || uploading || previewLocked}
        className="nodrag nopan relative h-6 w-6 shrink-0 overflow-hidden rounded-md border border-zinc-200/80 bg-zinc-100 transition hover:bg-white disabled:opacity-40"
        onClick={() => {
          if (previewLocked) return;
          inputRef.current?.click();
        }}
        aria-label={`${label}：${hasFrame ? "更换" : "上传"}`}
      >
        {thumb ? (
          <AssetThumb src={thumb} alt={label} />
        ) : (
          <ImagePlus className="m-auto h-3.5 w-3.5 text-zinc-500" />
        )}
      </button>
      {assetId && !previewLocked ? (
        <button
          type="button"
          disabled={disabled || uploading}
          className="nodrag nopan inline-flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-700 disabled:opacity-40"
          title={`清除${label}`}
          aria-label={`清除${label}`}
          onClick={() => onChange("")}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="hidden"
        disabled={disabled || uploading || previewLocked}
        onChange={(e) => void onUpload(e.target.files)}
      />
    </div>
  );
}
