"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { HANDLES } from "@/workflow/connection-rules";
import { useWorkflowStore } from "@/workflow/store";
import type { VideoGeneratorNodeData } from "@/workflow/types";

export function VideoGeneratorNodeView({ id, selected }: NodeProps) {
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | VideoGeneratorNodeData
        | undefined,
  );

  if (!nodeData) return null;

  return (
    <div
      className={`w-72 rounded-xl border bg-zinc-900/95 p-3 shadow-lg backdrop-blur ${
        selected
          ? "border-emerald-400 ring-1 ring-emerald-400/40"
          : "border-zinc-700"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLES.promptInput}
        style={{ top: "35%" }}
        className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-cyan-400"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLES.imageInput}
        style={{ top: "65%" }}
        className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-violet-400"
      />

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
          视频生成
        </span>
        {nodeData.isDemo && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
            演示
          </span>
        )}
      </div>
      <div className="mb-1 truncate text-sm font-medium text-zinc-100">
        {nodeData.title || "未命名生成器"}
      </div>
      <div className="space-y-1 text-[11px] text-zinc-400">
        <div>模型：{nodeData.model}</div>
        <div>
          {nodeData.aspectRatio} · {nodeData.duration}s · {nodeData.resolution}
        </div>
        <div>状态：{nodeData.status}</div>
      </div>
      <button
        type="button"
        className="nodrag nopan mt-3 w-full rounded-lg border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300"
        onClick={(e) => e.stopPropagation()}
      >
        生成能力将在下一阶段接入
      </button>

      <Handle
        type="source"
        position={Position.Right}
        id={HANDLES.videoOutput}
        className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-emerald-400"
      />
    </div>
  );
}
