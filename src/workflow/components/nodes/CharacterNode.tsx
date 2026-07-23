"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { HANDLES } from "@/workflow/connection-rules";
import { AssetUploadControls } from "@/workflow/components/AssetUploadControls";
import { useWorkflowStore } from "@/workflow/store";
import type { CharacterReferenceNodeData } from "@/workflow/types";

export function CharacterNodeView({ id, selected }: NodeProps) {
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | CharacterReferenceNodeData
        | undefined,
  );
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  if (!nodeData) return null;

  return (
    <div
      className={`w-64 rounded-xl border bg-zinc-900/95 p-3 shadow-lg ${
        selected
          ? "border-orange-400 ring-1 ring-orange-400/30"
          : "border-orange-900/60"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-orange-300">
          角色
        </span>
        <span className="text-[10px] text-zinc-500">参考图</span>
      </div>
      <div className="mb-2 truncate text-sm text-zinc-100">
        {nodeData.characterName || nodeData.title || "未命名角色"}
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
        id={HANDLES.characterOutput}
        className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-orange-400"
      />
    </div>
  );
}
