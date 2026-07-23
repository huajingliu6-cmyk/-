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
      className={`w-64 rounded-xl border bg-zinc-900/95 p-3 shadow-lg ${
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
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fuchsia-300">
        视频结果
      </div>
      <div className="mb-2 truncate text-sm text-zinc-100">
        {nodeData.title || "输出"}
      </div>
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/50 px-3 py-6 text-center text-[11px] text-zinc-500">
        尚未生成视频
      </div>
    </div>
  );
}
