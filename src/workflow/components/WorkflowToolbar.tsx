"use client";

import {
  ArrowLeft,
  Maximize2,
  Play,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import type { SaveStatus } from "@/workflow/store";

const STATUS_LABEL: Record<SaveStatus, string> = {
  loading: "正在加载",
  loaded: "已加载",
  dirty: "未保存",
  saving: "正在保存",
  saved: "已保存",
  error: "保存失败",
};

type Props = {
  projectName: string;
  saveStatus: SaveStatus;
  saveError: string | null;
  onFitView: () => void;
  onSaveNow: () => void;
  onRetrySave: () => void;
};

export function WorkflowToolbar({
  projectName,
  saveStatus,
  saveError,
  onFitView,
  onSaveNow,
  onRetrySave,
}: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/95 px-3 text-zinc-100">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 px-2 py-1.5 text-xs text-zinc-600"
          title="返回（占位）"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{projectName}</div>
          <div className="text-[11px] text-zinc-500">
            AI 视频工作流编辑器 · 开发阶段
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs">
          <span
            className={
              saveStatus === "error"
                ? "text-rose-300"
                : saveStatus === "saved"
                  ? "text-emerald-300"
                  : saveStatus === "dirty" || saveStatus === "saving"
                    ? "text-amber-300"
                    : "text-zinc-300"
            }
          >
            {STATUS_LABEL[saveStatus]}
          </span>
          {saveStatus === "error" && (
            <button
              type="button"
              onClick={onRetrySave}
              className="rounded bg-rose-500/20 px-2 py-0.5 text-rose-200 hover:bg-rose-500/30"
            >
              重试
            </button>
          )}
          <button
            type="button"
            onClick={onSaveNow}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-800"
            title="立即保存 (Ctrl/Cmd+S)"
          >
            <Save className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 px-2 py-1.5 text-xs text-zinc-600"
          title="撤销（占位）"
        >
          <Undo2 className="h-3.5 w-3.5" />
          撤销
        </button>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 px-2 py-1.5 text-xs text-zinc-600"
          title="重做（占位）"
        >
          <Redo2 className="h-3.5 w-3.5" />
          重做
        </button>
        <button
          type="button"
          onClick={onFitView}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Fit View
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300"
          title="尚未接入生成"
          onClick={() => {
            window.alert("尚未接入生成");
          }}
        >
          <Play className="h-3.5 w-3.5" />
          运行工作流
        </button>
      </div>

      {saveError && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-lg border border-rose-500/40 bg-rose-950/90 px-3 py-1.5 text-xs text-rose-200">
          {saveError}
        </div>
      )}
    </header>
  );
}
