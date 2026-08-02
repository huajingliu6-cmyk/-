"use client";

import { useId, useRef } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import type { ScriptSourceFile } from "@/projects/script/types";
import { SCRIPT_TXT_MAX_BYTES } from "@/projects/script/script-txt-constants";
import { SCRIPT_DOCX_MAX_BYTES } from "@/projects/script/script-docx-constants";
import { SCRIPT_MARKDOWN_MAX_BYTES } from "@/projects/script/script-markdown-constants";

type Props = {
  file: ScriptSourceFile | null;
  canSplit: boolean;
  importing: boolean;
  onScriptFile: (file: File) => void;
  onClientError: (message: string) => void;
  onOpenSplit: () => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_BYTES = Math.max(
  SCRIPT_TXT_MAX_BYTES,
  SCRIPT_DOCX_MAX_BYTES,
  SCRIPT_MARKDOWN_MAX_BYTES,
);

function isSupportedScriptName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".txt") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown")
  );
}

export function ScriptUploadPanel({
  file,
  canSplit,
  importing,
  onScriptFile,
  onClientError,
  onOpenSplit,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadBounce = useChipBounce();
  const splitBounce = useChipBounce();

  return (
    <div aria-label="上传完整剧本">
      <p className="scs-section-title" style={{ marginTop: 0 }}>
        上传完整剧本
        <span className="scs-req-star" aria-hidden>
          *
        </span>
      </p>
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
          if (!picked) return;
          if (!isSupportedScriptName(picked.name)) {
            const lower = picked.name.toLowerCase();
            onClientError(
              lower.endsWith(".pdf")
                ? "当前不支持 PDF 剧本，请转换为 TXT、DOCX 或 Markdown 后重新上传。"
                : "仅支持 .txt、.docx、.md 或 .markdown 文件",
            );
            return;
          }
          if (picked.size > MAX_BYTES) {
            onClientError(
              `文件超过 ${Math.floor(MAX_BYTES / (1024 * 1024))} MiB 上限`,
            );
            return;
          }
          if (picked.size === 0) {
            onClientError("文件为空");
            return;
          }
          onScriptFile(picked);
        }}
      />
      <div className="scs-btn-row">
        <button
          type="button"
          className={`scs-btn scs-btn-primary ${uploadBounce.bounceClass}`}
          disabled={importing}
          onClick={() => {
            uploadBounce.trigger();
            inputRef.current?.click();
          }}
          onAnimationEnd={uploadBounce.onAnimationEnd}
        >
          {importing ? "解析中…" : "上传剧本文件"}
        </button>
        <button
          type="button"
          className={`scs-btn ${splitBounce.bounceClass}`}
          disabled={!canSplit || importing}
          title={canSplit ? "本地分集" : "请先导入并确认源文本"}
          onClick={() => {
            if (!canSplit) return;
            splitBounce.trigger();
            onOpenSplit();
          }}
          onAnimationEnd={splitBounce.onAnimationEnd}
        >
          分集
        </button>
      </div>
      <p className="scs-hint scs-hint--req">
        <span className="scs-req-star" aria-hidden>
          *
        </span>
        选择 TXT / DOCX / Markdown 后先预览解析结果，确认后才写入剧本草稿。
      </p>
      <p className="scs-hint">
        支持：.txt、.docx、.md / .markdown。PDF
        为产品不支持格式。Markdown 仅作纯文本导入，不渲染 HTML。
      </p>

      {file ? (
        <div className="scs-file-card">
          <div className="scs-file-name">{file.name}</div>
          <div className="scs-meta-row">
            <span>{formatSize(file.size)}</span>
            <span>
              {file.status === "selected"
                ? "已选择"
                : file.status === "uploaded"
                  ? "已导入"
                  : file.status === "uploading"
                    ? "解析中"
                    : file.status === "error"
                      ? "失败"
                      : "待选择"}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
