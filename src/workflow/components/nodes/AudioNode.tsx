"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { HANDLES } from "@/workflow/connection-rules";
import { AssetUploadControls } from "@/workflow/components/AssetUploadControls";
import { useWorkflowStore } from "@/workflow/store";
import type { AudioReferenceNodeData } from "@/workflow/types";

export function AudioNodeView({ id, selected }: NodeProps) {
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | AudioReferenceNodeData
        | undefined,
  );
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  if (!nodeData) return null;

  return (
    <div
      className={`w-64 rounded-xl border bg-zinc-900/95 p-3 shadow-lg ${
        selected
          ? "border-amber-400 ring-1 ring-amber-400/30"
          : "border-zinc-700"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-300">
          音频
        </span>
      </div>
      <div className="mb-2 truncate text-sm text-zinc-100">
        {nodeData.title || "音频参考"}
      </div>
      <AssetUploadControls
        kind="audio"
        accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/m4a,.mp3,.wav,.m4a"
        assetUrl={nodeData.assetUrl}
        fileName={nodeData.fileName}
        uploadStatus={nodeData.uploadStatus}
        errorMessage={nodeData.errorMessage}
        onChange={(patch) =>
          updateNodeData(id, {
            ...patch,
            duration: patch.duration ?? nodeData.duration,
          })
        }
      />
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLES.audioOutput}
        className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-amber-400"
      />
    </div>
  );
}
