"use client";

import { useId, useRef } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import type {
  NovelConversionTask,
  ScriptSourceFile,
} from "@/projects/script/types";

type Props = {
  open: boolean;
  task: NovelConversionTask;
  onToggle: () => void;
  onNovelFileSelect: (file: ScriptSourceFile) => void;
  onStartConvert: () => void;
  onExportScript: () => void;
  onSplitScript: () => void;
  onEnterReading: () => void;
};

function detectType(name: string): ScriptSourceFile["type"] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".md")) return "md";
  return "unknown";
}

export function NovelToScriptPanel({
  open,
  task,
  onToggle,
  onNovelFileSelect,
  onStartConvert,
  onExportScript,
  onSplitScript,
  onEnterReading,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleBounce = useChipBounce();
  const uploadBounce = useChipBounce();
  const convertBounce = useChipBounce();
  const exportBounce = useChipBounce();
  const splitBounce = useChipBounce();
  const enterBounce = useChipBounce();

  const completed = task.status === "completed";
  const canConvert =
    task.sourceFile != null &&
    (task.status === "uploaded" || task.status === "failed");

  return (
    <div aria-label="小说转剧本">
      <p className="scs-section-title">小说转剧本</p>
      <div className="scs-btn-row">
        <button
          type="button"
          className={`scs-btn ${toggleBounce.bounceClass}`}
          onClick={() => {
            toggleBounce.trigger();
            onToggle();
          }}
          onAnimationEnd={toggleBounce.onAnimationEnd}
        >
          {open ? "收起小说转剧本" : "小说转剧本"}
        </button>
      </div>

      {open ? (
        <div className="scs-file-card">
          <p className="scs-section-title" style={{ marginTop: 0 }}>
            上传小说
          </p>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".docx,.txt,.md,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (!picked) return;
              onNovelFileSelect({
                id: `novel-${Date.now()}`,
                name: picked.name,
                type: detectType(picked.name),
                size: picked.size,
                status: "selected",
              });
              e.target.value = "";
            }}
          />
          <div className="scs-btn-row">
            <button
              type="button"
              className={`scs-btn ${uploadBounce.bounceClass}`}
              onClick={() => {
                uploadBounce.trigger();
                inputRef.current?.click();
              }}
              onAnimationEnd={uploadBounce.onAnimationEnd}
            >
              上传小说文件
            </button>
          </div>
          <p className="scs-hint">
            支持浏览器上传：.docx / .txt / .md。不会直接生成，需点击开始转换。
          </p>

          {task.sourceFile ? (
            <div className="scs-meta-row" style={{ marginTop: 10 }}>
              <span className="scs-file-name">{task.sourceFile.name}</span>
              <span>
                {task.status === "processing"
                  ? "转换中"
                  : task.status === "completed"
                    ? "转换完成"
                    : task.status === "failed"
                      ? "失败"
                      : "已上传"}
              </span>
            </div>
          ) : null}

          <div className="scs-btn-row">
            <button
              type="button"
              className={`scs-btn scs-btn-primary ${convertBounce.bounceClass}`}
              disabled={!canConvert}
              onClick={() => {
                convertBounce.trigger();
                onStartConvert();
              }}
              onAnimationEnd={convertBounce.onAnimationEnd}
            >
              开始转换剧本
            </button>
          </div>

          {completed ? (
            <div className="scs-file-card" style={{ marginTop: 12 }}>
              <p className="scs-status-value" style={{ fontSize: "0.95rem" }}>
                转换完成
              </p>
              <div className="scs-btn-row">
                <button
                  type="button"
                  className={`scs-btn ${exportBounce.bounceClass}`}
                  onClick={() => {
                    exportBounce.trigger();
                    onExportScript();
                  }}
                  onAnimationEnd={exportBounce.onAnimationEnd}
                >
                  导出剧本
                </button>
                <button
                  type="button"
                  className={`scs-btn ${splitBounce.bounceClass}`}
                  onClick={() => {
                    splitBounce.trigger();
                    onSplitScript();
                  }}
                  onAnimationEnd={splitBounce.onAnimationEnd}
                >
                  剧本分集
                </button>
                <button
                  type="button"
                  className={`scs-btn scs-btn-primary ${enterBounce.bounceClass}`}
                  onClick={() => {
                    enterBounce.trigger();
                    onEnterReading();
                  }}
                  onAnimationEnd={enterBounce.onAnimationEnd}
                >
                  进入剧本读取处理
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
