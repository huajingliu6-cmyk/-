"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { HANDLES } from "@/workflow/connection-rules";
import { useWorkflowStore } from "@/workflow/store";
import type { DirectorNodeData } from "@/workflow/types";

const SHOT_LABEL: Record<DirectorNodeData["shotSize"], string> = {
  extremeWide: "大远景",
  wide: "远景",
  medium: "中景",
  closeUp: "近景",
  extremeCloseUp: "特写",
};

export function DirectorNodeView({ id, selected }: NodeProps) {
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | DirectorNodeData
        | undefined,
  );

  if (!nodeData) return null;

  return (
    <div
      className={`w-64 rounded-xl border bg-zinc-900/95 p-3 shadow-lg ${
        selected
          ? "border-sky-400 ring-1 ring-sky-400/30"
          : "border-zinc-700"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-sky-300">
          3D 导演台
        </span>
        <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">
          New
        </span>
      </div>
      <div className="mb-2 truncate text-sm text-zinc-100">
        {nodeData.title || "镜头参数"}
      </div>
      <div className="space-y-1 text-[11px] text-zinc-400">
        <div>景别：{SHOT_LABEL[nodeData.shotSize]}</div>
        <div>角度：{nodeData.cameraAngle}</div>
        <div>运动：{nodeData.cameraMovement}</div>
        <div>
          镜头：{nodeData.lens} · 速度：{nodeData.movementSpeed}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLES.directorOutput}
        className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-sky-400"
      />
    </div>
  );
}
