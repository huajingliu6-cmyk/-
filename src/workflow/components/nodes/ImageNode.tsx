"use client";

import { useRef, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import { BrandMark } from "@/workflow/components/BrandMark";
import { ImageLightbox } from "@/workflow/components/ImageLightbox";
import { NodePorts } from "@/workflow/components/nodes/NodePorts";
import { useAssetsByIds } from "@/workflow/hooks/useAssetById";
import { uploadAssetFile } from "@/workflow/lib/upload-asset";
import { useWorkflowStore } from "@/workflow/store";
import type { ImageNodeData, ImageReferenceType } from "@/workflow/types";

const REF_LABEL: Record<ImageReferenceType, string> = {
  startFrame: "首帧",
  endFrame: "尾帧",
  style: "风格",
  composition: "构图",
  action: "动作",
  prop: "道具",
  general: "通用",
};

export function ImageNodeView({ id, selected }: NodeProps) {
  const projectId = useWorkflowStore((s) => s.projectId);
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | ImageNodeData
        | undefined,
  );
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const commitNodeAssets = useWorkflowStore((s) => s.commitNodeAssets);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(
    null,
  );

  const assetIds = nodeData
    ? [
        ...new Set([
          ...(nodeData.primaryAssetId ? [nodeData.primaryAssetId] : []),
          ...nodeData.assetIds,
        ]),
      ]
    : [];
  const resolvedAssets = useAssetsByIds(assetIds);

  if (!nodeData) return null;

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of Array.from(files)) {
        uploaded.push(
          await uploadAssetFile(file, {
            assetType: "referenceImage",
            projectId,
            name: file.name,
          }),
        );
      }
      const newIds = uploaded.map((a) => a.id);
      commitNodeAssets(id, uploaded, {
        assetIds: [...new Set([...nodeData.assetIds, ...newIds])],
        primaryAssetId: nodeData.primaryAssetId || newIds[0] || "",
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
          ? "border-sky-400 ring-1 ring-sky-400/30"
          : "border-zinc-700"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-sky-300">
          图片
        </span>
        <select
          className="nodrag nopan max-w-[7rem] rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-200"
          value={nodeData.referenceType}
          onChange={(e) =>
            updateNodeData(id, {
              referenceType: e.target.value as ImageReferenceType,
            })
          }
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(Object.keys(REF_LABEL) as ImageReferenceType[]).map((key) => (
            <option key={key} value={key}>
              {REF_LABEL[key]}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-2 truncate text-sm text-zinc-100">
        {nodeData.title || "图片参考"}
      </div>

      {assetIds.length === 0 && (
        <div className="nodrag nopan mb-2 flex aspect-video items-center justify-center rounded-md border border-zinc-700/80 bg-zinc-950/80">
          <BrandMark
            size={28}
            spin={uploading || nodeData.uploadStatus === "uploading"}
          />
        </div>
      )}

      <div className="nodrag nopan mb-2 grid grid-cols-3 gap-1">
        {resolvedAssets.map((asset, index) => {
          if (!asset) return null;
          const assetId = assetIds[index];
          return (
            <button
              type="button"
              key={assetId}
              className="relative aspect-square overflow-hidden rounded-md border border-zinc-700"
              title="双击放大预览"
              onDoubleClick={() => setPreview({ src: asset.url, alt: asset.name })}
            >
              <AssetThumb src={asset.url} alt={asset.name} />
            </button>
          );
        })}
        <button
          type="button"
          className="flex aspect-square items-center justify-center rounded-md border border-dashed border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <BrandMark size={20} spin /> : <Plus className="h-4 w-4" />}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        multiple
        className="hidden"
        onChange={(e) => void onUpload(e.target.files)}
      />

      {nodeData.uploadStatus === "uploading" && (
        <div className="text-[11px] text-sky-300">上传中…</div>
      )}
      {nodeData.errorMessage && (
        <div className="text-[11px] text-rose-300">{nodeData.errorMessage}</div>
      )}

      <NodePorts />

      <ImageLightbox
        src={preview?.src ?? null}
        alt={preview?.alt}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
