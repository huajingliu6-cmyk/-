"use client";

import { useEffect, useRef, useState } from "react";
import { AssetAudioPlayer } from "@/projects/assets/AssetAudioPlayer";
import { PROJECT_ASSET_AUDIO_ACCEPT } from "@/projects/assets/asset-audio-constants";
import {
  deleteProjectAssetAudio,
  uploadProjectAssetAudio,
  validateProjectAssetAudioFileClient,
} from "@/projects/assets/upload-asset-audio";
import {
  readVoiceAudioDurationSeconds,
  validateVoiceAudioDurationSeconds,
} from "@/projects/assets/voice-audio-validation";

export type AssetAudioValue = {
  fileName: string | null;
  objectUrl: string | null;
  mimeType: string | null;
  /** Local File held until the asset record exists and upload runs. */
  pendingFile?: File | null;
};

type Props = {
  id: string;
  label: string;
  tip?: string;
  value: AssetAudioValue;
  onChange: (next: AssetAudioValue) => void;
  projectId?: string;
  assetId?: string | null;
  ensurePersisted?: () => Promise<void>;
  disabled?: boolean;
  revision?: number;
  onRevisionChange?: (next: number) => void;
  /** Optional duration callback after client metadata read (UI only). */
  onDurationRead?: (durationLabel: string) => void;
  /** Voice uploads enforce 4-6s and 10MB limits. */
  variant?: "default" | "voice";
  showPlayer?: boolean;
};

function revokeIfBlob(url: string | null | undefined) {
  if (url && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function readAudioDuration(objectUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    const finish = (value: string) => {
      audio.removeAttribute("src");
      audio.load();
      resolve(value);
    };
    audio.onloadedmetadata = () => finish(formatDuration(audio.duration));
    audio.onerror = () => finish("");
    audio.src = objectUrl;
  });
}

export function AssetAudioUpload({
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
  onDurationRead,
  showPlayer = true,
  variant = "default",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const presenceKey = `${assetId ?? ""}:${value.fileName ?? ""}:${revision}`;
  const [missingKey, setMissingKey] = useState<string | null>(null);
  const missingOnServer = missingKey === presenceKey;
  const valueRef = useRef(value);
  const uploadGenRef = useRef(0);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      revokeIfBlob(valueRef.current.objectUrl);
    };
  }, []);

  const handleFile = (file: File | null) => {
    setError("");
    if (!file || disabled) return;

    const validationError = validateProjectAssetAudioFileClient(file, {
      variant,
    });
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
    const gen = ++uploadGenRef.current;

    void (async () => {
      const label = await readAudioDuration(blobUrl);
      if (gen !== uploadGenRef.current) return;

      if (variant === "voice") {
        const seconds = await readVoiceAudioDurationSeconds(file);
        const durationError = validateVoiceAudioDurationSeconds(seconds);
        if (durationError) {
          URL.revokeObjectURL(blobUrl);
          setError(durationError);
          return;
        }
      }

      if (label) {
        onDurationRead?.(label);
      }

      proceedWithFile(file, blobUrl, gen, previousDurable, previousBlob);
    })();
  };

  const proceedWithFile = (
    file: File,
    blobUrl: string,
    gen: number,
    previousDurable: { fileName: string | null; mimeType: string | null },
    previousBlob: string | null,
  ) => {
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
        if (gen !== uploadGenRef.current) {
          revokeIfBlob(blobUrl);
          return;
        }
        const uploaded = await uploadProjectAssetAudio(
          projectId,
          assetId,
          file,
        );
        if (gen !== uploadGenRef.current) {
          revokeIfBlob(blobUrl);
          return;
        }
        revokeIfBlob(blobUrl);
        const nextRevision = revision + 1;
        onRevisionChange?.(nextRevision);
        setMissingKey(null);
        onChange({
          fileName: uploaded.fileName,
          objectUrl: null,
          mimeType: uploaded.mimeType,
          pendingFile: null,
        });
      } catch (err) {
        if (gen !== uploadGenRef.current) {
          revokeIfBlob(blobUrl);
          return;
        }
        revokeIfBlob(blobUrl);
        onChange({
          fileName: previousDurable.fileName,
          objectUrl: null,
          mimeType: previousDurable.mimeType,
          pendingFile: null,
        });
        setError(err instanceof Error ? err.message : "上传音频失败");
      } finally {
        if (gen === uploadGenRef.current) {
          setBusy(false);
        }
      }
    })();
  };

  const clear = () => {
    if (disabled || busy) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm("确认清除已上传的音频文件？资产条目将保留。");
      if (!ok) return;
    }
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
        await deleteProjectAssetAudio(projectId, assetId);
        revokeIfBlob(previousBlob);
        onChange({
          fileName: null,
          objectUrl: null,
          mimeType: null,
          pendingFile: null,
        });
        onRevisionChange?.(revision + 1);
        setMissingKey(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "清除音频失败");
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    })();
  };

  const showEmpty =
    missingOnServer || (!value.fileName && !value.objectUrl?.startsWith("blob:"));

  return (
    <div className="amw-field">
      <label htmlFor={id}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        className="amw-file-input"
        type="file"
        accept={PROJECT_ASSET_AUDIO_ACCEPT}
        disabled={disabled || busy}
        data-testid="asset-audio-file-input"
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
          {busy ? "处理中…" : value.fileName ? "替换音频" : "选择音频"}
        </button>
        {value.fileName || value.objectUrl ? (
          <button
            type="button"
            className="amw-btn"
            disabled={disabled || busy}
            onClick={clear}
          >
            清除音频
          </button>
        ) : null}
        <span className="amw-file-name">
          {busy
            ? "上传中…"
            : showEmpty
              ? "未上传音频"
              : (value.fileName ?? "未选择音频")}
        </span>
      </div>
      {showPlayer && projectId && assetId && !showEmpty ? (
        <AssetAudioPlayer
          projectId={projectId}
          assetId={assetId}
          fileName={value.fileName}
          objectUrl={value.objectUrl}
          revision={revision}
          onError={() => {
            if (!value.objectUrl?.startsWith("blob:")) {
              setMissingKey(presenceKey);
            }
          }}
        />
      ) : null}
      {showPlayer && !projectId && value.objectUrl?.startsWith("blob:") ? (
        <audio
          className="amw-audio-player"
          controls
          src={value.objectUrl}
          preload="metadata"
          data-testid="asset-audio-player"
          data-audio-src="blob"
        >
          浏览器不支持音频播放
        </audio>
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
