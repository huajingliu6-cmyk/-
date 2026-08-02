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
  /** Ensure the asset row exists in assets.json before upload. */
  ensurePersisted?: () => Promise<void>;
  disabled?: boolean;
  /** Bumps after successful replace so <img> reloads despite Cache-Control. */
  revision?: number;
  onRevisionChange?: (next: number) => void;
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
  ensurePersisted,
  disabled = false,
  revision = 0,
  onRevisionChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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

    revokeIfBlob(previousBlob);
    onChange({
      fileName: previousDurable.fileName ?? file.name,
      objectUrl: blobUrl,
      mimeType: previousDurable.mimeType ?? (file.type || null),
      pendingFile: null,
    });

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
        );
        revokeIfBlob(blobUrl);
        const nextRevision = revision + 1;
        onRevisionChange?.(nextRevision);
        onChange({
          fileName: uploaded.imageFileName,
          objectUrl: null,
          mimeType: uploaded.imageMimeType,
          pendingFile: null,
        });
      } catch (err) {
        revokeIfBlob(blobUrl);
        // Restore previous durable metadata; never keep a failed blob as final src.
        onChange({
          fileName: previousDurable.fileName,
          objectUrl: null,
          mimeType: previousDurable.mimeType,
          pendingFile: null,
        });
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
    <div className="amw-field">
      <label htmlFor={id}>{label}</label>
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
      <div className="amw-file-row">
        <button
          type="button"
          className="amw-btn"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "处理中…" : "选择图片"}
        </button>
        {value.fileName || value.objectUrl ? (
          <button
            type="button"
            className="amw-btn"
            disabled={disabled || busy}
            onClick={clear}
          >
            清除
          </button>
        ) : null}
        <span className="amw-file-name">
          {busy ? "上传中…" : (value.fileName ?? "未选择图片")}
        </span>
      </div>
      {previewSrc ? (
        <AmwImagePreview src={previewSrc} alt={value.fileName ?? "预览"} />
      ) : null}
      {error ? <p className="amw-field-error">{error}</p> : null}
      {tip ? (
        <p className="amw-hint">
          <span className="req">*</span> {tip}
        </p>
      ) : null}
    </div>
  );
}
