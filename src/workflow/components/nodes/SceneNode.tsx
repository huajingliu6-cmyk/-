"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { HANDLES } from "@/workflow/connection-rules";
import { AssetUploadControls } from "@/workflow/components/AssetUploadControls";
import { useWorkflowStore } from "@/workflow/store";
import type { SceneReferenceNodeData } from "@/workflow/types";

export function SceneNodeView({ id, selected }: NodeProps) {
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | SceneReferenceNodeData
        | undefined,
  );
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  if (!nodeData) return null;

  return (
    <div
      className={`w-64 rounded-xl border bg-zinc-900/95 p-3 shadow-lg ${
        selected
          ? "border-teal-400 ring-1 ring-teal-400/30"
          : "border-teal-900/60"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-teal-300">
          场景
        </span>
        <span className="text-[10px] text-zinc-500">环境参考</span>
      </div>
      <div className="mb-2 truncate text-sm text-zinc-100">
        {nodeData.sceneName || nodeData.title || "未命名场景"}
      </div>
      <AssetUploadControls
        kind="image"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        assetUrl={nodeData.assetUrl}
        fileName={nodeData.fileName}
        uploadStatus={nodeData.uploadStatus}
        errorMessage={nodeData.errorMessage}
        onChange={(patch) => updateNodeData(id, patch)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLES.sceneOutput}
        className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-teal-400"
      />
    </div>
  );
}
