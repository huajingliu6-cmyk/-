"use client";

import { type NodeProps } from "@xyflow/react";
import { MentionTextarea } from "@/workflow/components/MentionTextarea";
import { NodePorts } from "@/workflow/components/nodes/NodePorts";
import { useWorkflowNodeData } from "@/workflow/hooks/useWorkflowNodeData";
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
  const nodeData = useWorkflowNodeData<TextNodeData>(id);
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
      <MentionTextarea
        variant="dark"
        className="h-24 border-zinc-700 bg-zinc-950 text-[11px] text-zinc-200 focus:border-cyan-500"
        value={nodeData.content}
        placeholder="输入剧本、对白、旁白或补充描述，键入 @ 引用素材…"
        onChange={(content) => updateNodeData(id, { content })}
      />
      <NodePorts />
    </div>
  );
}
