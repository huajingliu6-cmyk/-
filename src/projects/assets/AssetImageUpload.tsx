"use client";

import { useEffect, useRef, useState } from "react";
import { AmwImagePreview } from "@/projects/assets/AmwImagePreview";
import { getProjectAssetImageUrl } from "@/projects/assets/asset-image-url";
import {
  deleteProjectAssetImage,
  uploadProjectAssetImage,
  validateProjectAssetImageFileClient,
} from "@/projects/assets/upload-asset-image";

const ACCEPT_IMAGE = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

export type AssetImageValue = {
  fileName: string | null;
  objectUrl: string | null;
  mimeType: string | null;
  /** Local File held until the asset record exists and upload runs. */
  pendingFile?: File | null;
};

type Props = {
  id: string;
  label: string;
  /** Asterisk tip shown under the control */
  tip?: string;
  value: AssetImageValue;
  onChange: (next: AssetImageValue) => void;
  projectId?: string;
  /** When set, choosing a file uploads immediately (after ensurePersisted). */
  assetId?: string | null;
  /** Replace this owned media key while keeping assetId as the parent asset. */
  uploadTargetId?: string | null;
  /** Ensure the asset row exists in assets.json before upload. */
  ensurePersisted?: () => Promise<void>;
  disabled?: boolean;
  /** Bumps after successful replace so <img> reloads despite Cache-Control. */
  revision?: number;
  onRevisionChange?: (next: number) => void;
  /** 由外层已展示主图时隐藏本组件内预览，避免重复渲染 */
  hidePreview?: boolean;
  /** Compact single-row actions for library controls pane */
  compact?: boolean;
  /** Library replace mode: hide clear + filename, keep select-to-replace */
  replaceOnly?: boolean;
  /** Adapt select-button text/chrome to image luminance */
  adaptiveContrast?: boolean;
  actionLabel?: string;
  /** Generated sub-media replacement must not rewrite the parent image metadata. */
  preserveValueOnUpload?: boolean;
};

function revokeIfBlob(url: string | null | undefined) {
  if (url && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

export function AssetImageUpload({
  id,
  label,
  tip,
  value,
  onChange,
  projectId,
  assetId,
  uploadTargetId,
  ensurePersisted,
  disabled = false,
  revision = 0,
  onRevisionChange,
  hidePreview = false,
  compact = false,
  replaceOnly = false,
  adaptiveContrast = false,
  actionLabel = "选择图片",
  preserveValueOnUpload = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageTone, setImageTone] = useState<"light" | "dark">("dark");
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      revokeIfBlob(valueRef.current.objectUrl);
    };
  }, []);

  const previewSrc = (() => {
    if (value.objectUrl?.startsWith("blob:")) return value.objectUrl;
    if (projectId && assetId && value.fileName) {
      return getProjectAssetImageUrl(projectId, assetId, { revision });
    }
    return null;
  })();

  useEffect(() => {
    if (!adaptiveContrast || !previewSrc) {
      return;
    }

    let cancelled = false;
    const image = new Image();

    if (!previewSrc.startsWith("blob:")) {
      image.crossOrigin = "anonymous";
    }

    image.onload = () => {
      if (cancelled) return;

      try {
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;

        const context = canvas.getContext("2d", {
          willReadFrequently: true,
        });

        if (!context) {
          setImageTone("dark");
          return;
        }

        context.drawImage(image, 0, 0, 16, 16);

        const pixels = context.getImageData(0, 0, 16, 16).data;
        let luminance = 0;
        let count = 0;

        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3] / 255;
          if (alpha < 0.1) continue;

          const red = pixels[index] / 255;
          const green = pixels[index + 1] / 255;
          const blue = pixels[index + 2] / 255;

          luminance +=
            (0.2126 * red + 0.7152 * green + 0.0722 * blue) * alpha;
          count += alpha;
        }

        if (!cancelled && count > 0) {
          setImageTone(luminance / count > 0.62 ? "light" : "dark");
        }
      } catch {
        if (!cancelled) setImageTone("dark");
      }
    };

    image.onerror = () => {
      if (!cancelled) setImageTone("dark");
    };

    image.src = previewSrc;

    return () => {
      cancelled = true;
    };
  }, [adaptiveContrast, previewSrc]);

  const handleFile = (file: File | null) => {
    setError("");
    if (!file || disabled) return;

    const validationError = validateProjectAssetImageFileClient(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    const previousDurable = {
      fileName: value.fileName,
      mimeType: value.mimeType,
    };
    const previousBlob = value.objectUrl;
    const blobUrl = URL.createObjectURL(file);

    // Create-dialog mode: keep File until parent persists the asset, then uploads.
    if (!projectId || !assetId) {
      revokeIfBlob(previousBlob);
      onChange({
        fileName: file.name,
        objectUrl: blobUrl,
        mimeType: file.type || null,
        pendingFile: file,
      });
      return;
    }

    if (preserveValueOnUpload) {
      revokeIfBlob(blobUrl);
    } else {
      revokeIfBlob(previousBlob);
      onChange({
        fileName: previousDurable.fileName ?? file.name,
        objectUrl: blobUrl,
        mimeType: previousDurable.mimeType ?? (file.type || null),
        pendingFile: null,
      });
    }

    void (async () => {
      setBusy(true);
      try {
        if (ensurePersisted) {
          await ensurePersisted();
        }
        const uploaded = await uploadProjectAssetImage(
          projectId,
          assetId,
          file,
          { targetMediaId: uploadTargetId },
        );
        if (!preserveValueOnUpload) revokeIfBlob(blobUrl);
        const nextRevision = revision + 1;
        onRevisionChange?.(nextRevision);
        if (!preserveValueOnUpload) {
          onChange({
            fileName: uploaded.imageFileName,
            objectUrl: null,
            mimeType: uploaded.imageMimeType,
            pendingFile: null,
          });
        }
      } catch (err) {
        if (!preserveValueOnUpload) {
          revokeIfBlob(blobUrl);
          // Restore previous durable metadata; never keep a failed blob as final src.
          onChange({
            fileName: previousDurable.fileName,
            objectUrl: null,
            mimeType: previousDurable.mimeType,
            pendingFile: null,
          });
        }
        setError(err instanceof Error ? err.message : "上传图片失败");
      } finally {
        setBusy(false);
      }
    })();
  };

  const clear = () => {
    if (disabled || busy) return;
    setError("");
    const previousBlob = value.objectUrl;

    if (!projectId || !assetId) {
      revokeIfBlob(previousBlob);
      onChange({
        fileName: null,
        objectUrl: null,
        mimeType: null,
        pendingFile: null,
      });
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    void (async () => {
      setBusy(true);
      try {
        await deleteProjectAssetImage(projectId, assetId);
        revokeIfBlob(previousBlob);
        onChange({
          fileName: null,
          objectUrl: null,
          mimeType: null,
          pendingFile: null,
        });
        onRevisionChange?.(revision + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "清除图片失败");
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    })();
  };

  return (
    <div
      className={`amw-field${compact ? " amw-field--image-compact" : ""}`}
    >
      {compact ? null : <label htmlFor={id}>{label}</label>}
      <input
        ref={inputRef}
        id={id}
        className="amw-file-input"
        type="file"
        accept={ACCEPT_IMAGE}
        disabled={disabled || busy}
        onChange={(e) => {
          handleFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <div
        className={
          compact ? "asset-controls__image-actions-row amw-file-row" : "amw-file-row"
        }
      >
        <button
          type="button"
          className="amw-btn asset-image-upload__select"
          data-testid={`${id}-select`}
          data-image-tone={adaptiveContrast ? imageTone : undefined}
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "处理中…" : actionLabel}
        </button>
        {!replaceOnly ? (
          <button
            type="button"
            className="amw-btn asset-image-upload__clear"
            data-testid={`${id}-clear`}
            disabled={disabled || busy || !(value.fileName || value.objectUrl)}
            onClick={clear}
          >
            清除
          </button>
        ) : null}
        {!replaceOnly ? (
          <span className="amw-file-name" title={value.fileName ?? undefined}>
            {busy ? "上传中…" : (value.fileName ?? "未选择图片")}
          </span>
        ) : null}
      </div>
      {previewSrc && !hidePreview ? (
        <AmwImagePreview src={previewSrc} alt={value.fileName ?? "预览"} />
      ) : null}
      {error ? <p className="amw-field-error">{error}</p> : null}
      {tip && !compact ? (
        <p className="amw-hint">
          <span className="req">*</span> {tip}
        </p>
      ) : null}
    </div>
  );
}
