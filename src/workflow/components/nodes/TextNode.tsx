"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { HANDLES } from "@/workflow/connection-rules";
import { useWorkflowStore } from "@/workflow/store";
import type { TextNodeData } from "@/workflow/types";

const TEXT_LABEL: Record<TextNodeData["textType"], string> = {
  script: "剧本",
  dialogue: "对白",
  narration: "旁白",
  subtitle: "字幕",
  instruction: "补充描述",
};

export function TextNodeView({ id, selected }: NodeProps) {
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | TextNodeData
        | undefined,
  );
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  if (!nodeData) return null;

  return (
    <div
      className={`w-72 rounded-xl border bg-zinc-900/95 p-3 shadow-lg ${
        selected
          ? "border-cyan-400 ring-1 ring-cyan-400/30"
          : "border-zinc-700"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
          文本
        </span>
        <span className="text-[10px] text-zinc-500">
          {TEXT_LABEL[nodeData.textType]}
        </span>
      </div>
      <div className="mb-2 truncate text-sm text-zinc-100">
        {nodeData.title || "文本节点"}
      </div>
      <textarea
        className="nodrag nopan nowheel h-24 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-cyan-500"
        value={nodeData.content}
        placeholder="输入剧本、对白、旁白或补充描述…"
        onChange={(e) => updateNodeData(id, { content: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLES.textOutput}
        className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-cyan-400"
      />
    </div>
  );
}
