"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ImageIcon } from "lucide-react";
import { HANDLES } from "@/workflow/connection-rules";
import { useWorkflowStore } from "@/workflow/store";
import type { ImageNodeData } from "@/workflow/types";

export function ImageNodeView({ id, selected }: NodeProps) {
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | ImageNodeData
        | undefined,
  );

  if (!nodeData) return null;

  const showPreview =
    !!nodeData.assetUrl && !nodeData.assetUrl.startsWith("blob:");

  return (
    <div
      className={`w-64 rounded-xl border bg-zinc-900/95 p-3 shadow-lg backdrop-blur ${
        selected
          ? "border-violet-400 ring-1 ring-violet-400/40"
          : "border-zinc-700"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-violet-300">
          图片
        </span>
        {nodeData.isDemo && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
            演示
          </span>
        )}
      </div>
      <div className="mb-2 truncate text-sm font-medium text-zinc-100">
        {nodeData.title || "未命名图片"}
      </div>
      <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
        {showPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={nodeData.assetUrl}
            alt={nodeData.fileName || nodeData.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 px-2 text-center text-[11px] text-zinc-500">
            <ImageIcon className="h-5 w-5" />
            {nodeData.assetUrl.startsWith("blob:")
              ? "临时预览刷新后会失效"
              : "尚未设置图片 URL"}
          </div>
        )}
      </div>
      {nodeData.ephemeralHint && (
        <p className="mt-2 text-[11px] text-amber-300">{nodeData.ephemeralHint}</p>
      )}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLES.imageOutput}
        className="!h-3 !w-3 !border-2 !border-zinc-900 !bg-violet-400"
      />
    </div>
  );
}
