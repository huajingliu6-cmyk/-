"use client";

import { useRef, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { NodePorts } from "@/workflow/components/nodes/NodePorts";
import { BrandMark } from "@/workflow/components/BrandMark";
import { StableAudioPlayer } from "@/workflow/components/StableAudioPlayer";
import { useAssetById } from "@/workflow/hooks/useAssetById";
import { uploadAssetFile } from "@/workflow/lib/upload-asset";
import { useWorkflowNodeData } from "@/workflow/hooks/useWorkflowNodeData";
import { useWorkflowStore } from "@/workflow/store";
import type { AudioNodeData } from "@/workflow/types";

export function AudioNodeView({ id, selected }: NodeProps) {
  const projectId = useWorkflowStore((s) => s.projectId);
  const nodeData = useWorkflowNodeData<AudioNodeData>(id);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const commitNodeAssets = useWorkflowStore((s) => s.commitNodeAssets);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const asset = useAssetById(nodeData?.assetId);

  if (!nodeData) return null;

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);

    try {
      const uploaded = await uploadAssetFile(file, {
        assetType: "audio",
        projectId,
        name: file.name,
      });
      commitNodeAssets(id, [uploaded], {
        assetId: uploaded.id,
        uploadStatus: "ready",
        errorMessage: "",
      });
    } catch (error) {
      updateNodeData(id, {
        uploadStatus: "error",
        errorMessage:
          error instanceof Error ? error.message : "上传失败，请重试",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

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

      <div className="nodrag nopan space-y-2">
        {asset && nodeData.uploadStatus === "ready" && (
          <StableAudioPlayer src={asset.url} />
        )}

        {(!asset || uploading || nodeData.uploadStatus === "uploading") && (
          <div className="flex min-h-[52px] items-center justify-center rounded-lg border border-zinc-700/80 bg-zinc-950/70">
            <BrandMark
              size={22}
              spin={uploading || nodeData.uploadStatus === "uploading"}
            />
          </div>
        )}

        <button
          type="button"
          className="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-100"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {asset ? "替换音频" : "上传音频"}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/m4a,audio/aac,.mp3,.wav,.m4a,.aac"
          className="hidden"
          onChange={(e) => void onUpload(e.target.files?.[0])}
        />
      </div>

      {nodeData.errorMessage && (
        <div className="mt-1 text-[11px] text-rose-300">
          {nodeData.errorMessage}
        </div>
      )}

      <NodePorts />
    </div>
  );
}
