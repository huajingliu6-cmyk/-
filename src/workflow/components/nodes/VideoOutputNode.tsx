"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { HANDLES } from "@/workflow/connection-rules";
import { useWorkflowStore } from "@/workflow/store";
import type { VideoOutputNodeData } from "@/workflow/types";

export function VideoOutputNodeView({ id, selected }: NodeProps) {
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | VideoOutputNodeData
        | undefined,
  );

  if (!nodeData) return null;

  return (
    <div
      className={`w-64 rounded-xl border bg-zinc-900/95 p-3 shadow-lg backdrop-blur ${
        selected
          ? "border-fuchsia-400 ring-1 ring-fuchsia-400/40"
          : "border-zinc-700"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLES.videoInput}
        className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-fuchsia-400"
      />
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-fuchsia-300">
          视频结果
        </span>
        {nodeData.isDemo && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
            演示
          </span>
        )}
      </div>
      <div className="mb-1 truncate text-sm font-medium text-zinc-100">
        {nodeData.title || "未命名结果"}
      </div>
      <div className="space-y-1 text-[11px] text-zinc-400">
        <div>状态：{nodeData.status}</div>
        <div className="truncate">
          视频：{nodeData.videoUrl || "（尚未生成）"}
        </div>
        {nodeData.errorMessage && (
          <div className="text-rose-300">{nodeData.errorMessage}</div>
        )}
      </div>
    </div>
  );
}
