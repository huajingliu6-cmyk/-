"use client";

import { useCallback, useId, useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import { useChipBounce } from "@/shell/useChipBounce";
import type { ScriptSourceFile } from "@/projects/script/types";
import { SCRIPT_UPLOAD_MAX_CHARS_LABEL } from "@/projects/script/script-upload-limits";
import { validateScriptImportFileClient } from "@/projects/script/script-txt-client";
import "@/projects/script/script-workspace.css";

type Props = {
  file: ScriptSourceFile | null;
  pendingFile?: File | null;
  importing: boolean;
  onScriptFile: (file: File) => void;
  onRemove?: () => void;
  onClientError: (message: string) => void;
  /** panel: script workspace; dropzone: create-project wizard */
  variant?: "panel" | "dropzone";
  /** dropzone 场景下在标题旁显示必选星标 */
  required?: boolean;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileLabel(file: ScriptSourceFile | File): string {
  return "name" in file && typeof file.name === "string"
    ? file.name.replace(/\\/g, "/").split("/").pop() || file.name
    : file.name;
}

function fileSize(file: ScriptSourceFile | File): number {
  return file.size;
}

export function ScriptUploadPanel({
  file,
  pendingFile = null,
  importing,
  onScriptFile,
  onRemove,
  onClientError,
  variant = "panel",
  required = false,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadBounce = useChipBounce();
  const [dragOver, setDragOver] = useState(false);

  const displayFile = file ?? pendingFile;
  const isDropzone = variant === "dropzone";
  const showWizardFileRow = isDropzone && Boolean(displayFile);

  const pickFile = useCallback(
    (picked: File | undefined) => {
      if (!picked || importing) return;
      const error = validateScriptImportFileClient(picked);
      if (error) {
        onClientError(error);
        return;
      }
      onScriptFile(picked);
    },
    [importing, onClientError, onScriptFile],
  );

  const handleRemove = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    onRemove?.();
  };

  return (
    <div
      aria-label="上传完整剧本"
      className={isDropzone ? "scs-upload-dropzone-wrap" : undefined}
    >
      {!isDropzone ? (
        <p className="scs-section-title" style={{ marginTop: 0 }}>
          上传完整剧本
          <span className="scs-req-star" aria-hidden>
            *
          </span>
        </p>
      ) : null}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept=".txt,.docx,.md,.markdown,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        data-testid="script-file-input"
        disabled={importing}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          pickFile(picked);
        }}
      />

      {showWizardFileRow ? (
        <div
          className="scs-file-row scs-file-row--wizard"
          data-testid="script-upload-file-row"
        >
          <div className="scs-file-row__main">
            <div className="scs-file-name">{fileLabel(displayFile!)}</div>
            <span className="scs-file-row__size">
              {formatSize(fileSize(displayFile!))}
            </span>
          </div>
          {onRemove ? (
            <button
              type="button"
              className="scs-file-remove scs-file-remove--icon"
              data-testid="script-upload-remove"
              disabled={importing}
              aria-label="删除剧本"
              title={importing ? "处理中，暂不能删除" : "删除剧本"}
              onClick={(event) => {
                event.stopPropagation();
                handleRemove();
              }}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div
            className={`scs-upload-dropzone${isDropzone ? " is-wizard" : ""}${
              dragOver ? " is-dragover" : ""
            }${displayFile ? " has-file" : ""}`}
            data-testid="script-upload-dropzone"
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!importing) setDragOver(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!importing) setDragOver(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOver(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOver(false);
              pickFile(event.dataTransfer.files?.[0]);
            }}
            onClick={() => {
              if (importing) return;
              uploadBounce.trigger();
              inputRef.current?.click();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!importing) inputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-disabled={importing}
          >
            <span className="scs-upload-dropzone__icon" aria-hidden>
              <FileUp size={isDropzone ? 22 : 18} />
            </span>
            <span className="scs-upload-dropzone__title">
              {importing
                ? "处理中…"
                : displayFile
                  ? "重新选择剧本文件"
                  : isDropzone
                    ? "上传剧本"
                    : "上传剧本文件"}
              {isDropzone && required && !displayFile && !importing ? (
                <span className="scs-req-star" aria-hidden>
                  {" "}
                  *
                </span>
              ) : null}
            </span>
            <span className="scs-upload-dropzone__hint">
              点击选择或拖拽 TXT / DOCX / Markdown 到此处
            </span>
          </div>
          <p className="scs-hint scs-upload-limit-note">
            剧本内容最多 {SCRIPT_UPLOAD_MAX_CHARS_LABEL}，超过后将无法导入。
          </p>
          <p className="scs-hint scs-hint--req">
            <span className="scs-req-star" aria-hidden>
              *
            </span>
            选择 TXT / DOCX / Markdown 后将自动保存并创建剧集，无需再点确认分集。
          </p>
        </>
      )}

      {!isDropzone && displayFile ? (
        <div className="scs-file-card" data-testid="script-upload-file-card">
          <div className="scs-file-card__head">
            <div className="scs-file-name">{fileLabel(displayFile)}</div>
            {onRemove ? (
              <button
                type="button"
                className="scs-file-remove scs-file-remove--icon"
                data-testid="script-upload-remove"
                disabled={importing}
                aria-label="删除剧本"
                title={importing ? "处理中，暂不能删除" : "删除剧本"}
                onClick={(event) => {
                  event.stopPropagation();
                  handleRemove();
                }}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
          <div className="scs-meta-row">
            <span>{formatSize(fileSize(displayFile))}</span>
            <span>
              {file
                ? file.status === "selected"
                  ? "已选择"
                  : file.status === "uploaded"
                    ? "已导入"
                    : file.status === "uploading"
                      ? "解析中"
                      : file.status === "error"
                        ? "失败"
                        : "待选择"
                : "已选择"}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
