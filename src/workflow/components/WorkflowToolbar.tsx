"use client";

import {
  ArrowLeft,
  Clapperboard,
  Film,
  Grid3x3,
  LayoutGrid,
  Maximize2,
  PanelLeft,
  PanelTop,
  Play,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import type {
  NodeDensity,
  QuickCreateDockPosition,
  WorkbenchLayoutMode,
} from "@/workflow/types";
import { BrandMark } from "@/workflow/components/BrandMark";
import { AuthUserMenu } from "@/auth/AuthUserMenu";
import { useWorkflowStore, type SaveStatus } from "@/workflow/store";

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
  layoutMode: WorkbenchLayoutMode;
  dockPosition: QuickCreateDockPosition;
  nodeDensity: NodeDensity;
  onFitView: () => void;
  onSaveNow: () => void;
  onRetrySave: () => void;
  onLayoutModeChange: (mode: WorkbenchLayoutMode) => void;
  onDockPositionChange: (position: QuickCreateDockPosition) => void;
  onNodeDensityChange: (density: NodeDensity) => void;
};

export function WorkflowToolbar({
  projectName,
  layoutMode,
  dockPosition,
  nodeDensity,
  onFitView,
  onSaveNow,
  onRetrySave,
  onLayoutModeChange,
  onDockPositionChange,
  onNodeDensityChange,
}: Props) {
  // 工具栏自己订阅保存状态，避免每次 dirty/saving/saved 拖着整张画布重渲
  const saveStatus = useWorkflowStore((s) => s.saveStatus);
  const saveError = useWorkflowStore((s) => s.saveError);
  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/95 px-3 text-zinc-100">
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
            智能视频工作台 · 素材驱动编排
          </div>
        </div>
      </div>

      <div className="hidden items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 md:flex">
        {(
          [
            { mode: "canvas" as const, label: "画布", icon: LayoutGrid },
            { mode: "assets" as const, label: "素材", icon: Grid3x3 },
            { mode: "storyboard" as const, label: "分镜", icon: Film },
          ] as const
        ).map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${
              layoutMode === mode
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => onLayoutModeChange(mode)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 sm:flex">
          <button
            type="button"
            className={`rounded-md p-1 ${
              dockPosition === "top"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            title="顶部快速创建"
            onClick={() => onDockPositionChange("top")}
          >
            <PanelTop className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`rounded-md p-1 ${
              dockPosition === "left"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            title="左侧快速创建"
            onClick={() => onDockPositionChange("left")}
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="hidden items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 sm:flex">
          {(["fixed", "free"] as const).map((density) => (
            <button
              key={density}
              type="button"
              className={`rounded-md px-2 py-0.5 text-[10px] ${
                nodeDensity === density
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              title={
                density === "fixed"
                  ? "固定：网格对齐与吸附"
                  : "自由：随意摆放节点"
              }
              onClick={() => onNodeDensityChange(density)}
            >
              {density === "fixed" ? "固定" : "自由"}
            </button>
          ))}
        </div>

        <div className="flex w-[9.5rem] shrink-0 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs">
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            {(saveStatus === "loading" || saveStatus === "saving") && (
              <BrandMark size={14} spin />
            )}
          </span>
          <span
            className={`min-w-0 flex-1 truncate ${
              saveStatus === "error"
                ? "text-rose-300"
                : saveStatus === "saved"
                  ? "text-emerald-300"
                  : saveStatus === "dirty" || saveStatus === "saving"
                    ? "text-amber-300"
                    : "text-zinc-300"
            }`}
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
          className="hidden items-center gap-1 rounded-lg border border-zinc-800 px-2 py-1.5 text-xs text-zinc-600 sm:inline-flex"
          title="撤销（占位）"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled
          className="hidden items-center gap-1 rounded-lg border border-zinc-800 px-2 py-1.5 text-xs text-zinc-600 sm:inline-flex"
          title="重做（占位）"
        >
          <Redo2 className="h-3.5 w-3.5" />
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
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          onClick={() => {
            window.alert("分镜预演功能尚未开放，当前仅支持画布编排与输入检查。");
          }}
        >
          <Clapperboard className="h-3.5 w-3.5" />
          分镜预演
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-2.5 py-1.5 text-xs text-emerald-200 hover:bg-emerald-950/60"
          onClick={() => {
            window.alert("当前尚未连接真实 AI 视频服务，请在镜头节点中使用「检查生成输入」。");
          }}
        >
          <Play className="h-3.5 w-3.5" />
          生成视频
        </button>
        <AuthUserMenu />
      </div>

      {saveError && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 max-w-[min(92vw,36rem)] -translate-x-1/2 rounded-lg border border-rose-500/40 bg-rose-950/90 px-3 py-1.5 text-xs leading-snug text-rose-200 shadow">
          {saveError}
        </div>
      )}
    </header>
  );
}
