"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { HANDLES } from "@/workflow/connection-rules";
import { useWorkflowStore } from "@/workflow/store";
import type { PromptNodeData } from "@/workflow/types";

export function PromptNodeView({ id, selected }: NodeProps) {
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | PromptNodeData
        | undefined,
  );

  if (!nodeData) return null;

  return (
    <div
      className={`w-64 rounded-xl border bg-zinc-900/95 p-3 shadow-lg backdrop-blur ${
        selected ? "border-cyan-400 ring-1 ring-cyan-400/40" : "border-zinc-700"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
          提示词
        </span>
        {nodeData.isDemo && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
            演示
          </span>
        )}
      </div>
      <div className="mb-1 truncate text-sm font-medium text-zinc-100">
        {nodeData.title || "未命名提示词"}
      </div>
      <p className="line-clamp-3 text-xs leading-5 text-zinc-400">
        {nodeData.prompt || "（空提示词）"}
      </p>
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLES.promptOutput}
        className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-cyan-400"
      />
    </div>
  );
}
