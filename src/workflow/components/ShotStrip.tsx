"use client";

import {
  ChevronDown,
  ChevronUp,
  Copy,
  PanelBottom,
  Plus,
  Trash2,
} from "lucide-react";
import { useWorkflowStore } from "@/workflow/store";
import type { JobStatus, VideoShotNode } from "@/workflow/types";

const STATUS_LABEL: Record<JobStatus, string> = {
  idle: "待生成",
  queued: "排队中",
  processing: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

type Props = {
  collapsed: boolean;
  onToggle: () => void;
  onSelectShot: (shotId: string) => void;
  onDuplicateShot: (shotId: string) => void;
  onDeleteShot: (shotId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onAddShot: () => void;
};

export function ShotStrip({
  collapsed,
  onToggle,
  onSelectShot,
  onDuplicateShot,
  onDeleteShot,
  onReorder,
  onAddShot,
}: Props) {
  const shotOrder = useWorkflowStore((s) => s.document.shotOrder);
  const nodes = useWorkflowStore((s) => s.document.nodes);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);

  const shots = shotOrder
    .map((id) =>
      nodes.find(
        (n): n is VideoShotNode => n.id === id && n.type === "videoShot",
      ),
    )
    .filter((n): n is VideoShotNode => Boolean(n));

  if (collapsed) {
    return (
      <div className="flex h-10 shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-950/95 px-3">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
          onClick={onToggle}
        >
          <PanelBottom className="h-3.5 w-3.5" />
          镜头条 ({shots.length})
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
          onClick={onAddShot}
          title="新建视频镜头"
        >
          <Plus className="h-3.5 w-3.5" />
          视频
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-36 shrink-0 flex-col border-t border-zinc-800 bg-zinc-950/95">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-300">镜头条</span>
          <span className="text-[11px] text-zinc-500">
            {shots.length} 个镜头
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            onClick={onAddShot}
            title="新建视频镜头"
          >
            <Plus className="h-3.5 w-3.5" />
            新建视频
          </button>
          <button
            type="button"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
            onClick={onToggle}
            title="收起镜头条"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-2 overflow-x-auto p-2">
        {shots.length === 0 && (
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 text-[11px] text-zinc-400 transition hover:border-emerald-500/50 hover:bg-emerald-950/20 hover:text-emerald-200"
            onClick={onAddShot}
          >
            <Plus className="h-3.5 w-3.5" />
            点击新建视频镜头
          </button>
        )}

        {shots.map((shot, index) => {
          const selected = selectedNodeId === shot.id;
          return (
            <div
              key={shot.id}
              className={`flex w-52 shrink-0 flex-col rounded-lg border p-2 transition ${
                selected
                  ? "border-emerald-500/60 bg-emerald-950/20"
                  : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
              }`}
            >
              <button
                type="button"
                className="mb-1 text-left"
                onClick={() => onSelectShot(shot.id)}
              >
                <div className="text-[11px] font-medium text-emerald-300">
                  镜头 {shot.data.shotNumber}
                </div>
                <div className="truncate text-xs text-zinc-100">
                  {shot.data.title || "未命名"}
                </div>
                <div className="mt-1 text-[10px] text-zinc-500">
                  {shot.data.duration}s · {STATUS_LABEL[shot.data.status]}
                </div>
              </button>

              <div className="mt-auto flex items-center gap-1 pt-1">
                <button
                  type="button"
                  className="rounded border border-zinc-700 p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
                  disabled={index === 0}
                  title="上移"
                  onClick={() => onReorder(index, index - 1)}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded border border-zinc-700 p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
                  disabled={index === shots.length - 1}
                  title="下移"
                  onClick={() => onReorder(index, index + 1)}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded border border-zinc-700 p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                  title="复制镜头"
                  onClick={() => onDuplicateShot(shot.id)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded border border-zinc-700 p-0.5 text-zinc-500 hover:bg-rose-950/50 hover:text-rose-300"
                  title="删除镜头"
                  onClick={() => onDeleteShot(shot.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
