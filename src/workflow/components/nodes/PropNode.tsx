"use client";

import { useRef, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { Package, Plus, ZoomIn } from "lucide-react";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import { BrandMarkFrame } from "@/workflow/components/BrandMark";
import { ImageLightbox } from "@/workflow/components/ImageLightbox";
import { GlassIconButton, glass } from "@/workflow/components/glass-ui";
import { NodePorts } from "@/workflow/components/nodes/NodePorts";
import { useAssetById, useAssetsByIds } from "@/workflow/hooks/useAssetById";
import { uploadAssetFile } from "@/workflow/lib/upload-asset";
import { useWorkflowNodeData } from "@/workflow/hooks/useWorkflowNodeData";
import { useWorkflowStore } from "@/workflow/store";
import type { PropNodeData } from "@/workflow/types";

export function PropNodeView({ id, selected }: NodeProps) {
  const projectId = useWorkflowStore((s) => s.projectId);
  const nodeData = useWorkflowNodeData<PropNodeData>(id);
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
  const primaryAsset = useAssetById(nodeData?.primaryAssetId);
  const galleryAssets = useAssetsByIds(assetIds.slice(0, 4));

  if (!nodeData) return null;

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of Array.from(files)) {
        uploaded.push(
          await uploadAssetFile(file, {
            assetType: "propImage",
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
        propName: nodeData.propName || uploaded[0]?.name || "",
        title: nodeData.title || uploaded[0]?.name || "道具",
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

  const statusText =
    uploading || nodeData.uploadStatus === "uploading"
      ? "上传中…"
      : primaryAsset
        ? "道具参考 已就绪"
        : "道具参考 待补充";
  const toneClass = primaryAsset ? "text-emerald-700" : "text-amber-700";

  return (
    <div className="relative">
      <div
        className={`relative w-[232px] p-2.5 ${
          selected ? glass.cardSelected : glass.card
        }`}
      >
        <NodePorts />

        <div className="mb-2 flex items-center gap-1.5 px-0.5 text-zinc-800">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/80 bg-white/90">
            <Package className="h-3.5 w-3.5 text-zinc-600" />
          </span>
          <span className="truncate text-[13px] font-semibold tracking-tight">
            {nodeData.propName || nodeData.title || "未命名道具"}
          </span>
        </div>

        <div className="relative mb-2 overflow-hidden rounded-[16px]">
          <button
            type="button"
            className="nodrag nopan relative flex aspect-square w-full items-center justify-center overflow-hidden bg-[#e8eaee]/70"
            disabled={uploading}
            title={primaryAsset ? "双击放大预览" : "请使用下方 + 上传图片"}
            onDoubleClick={() => {
              if (primaryAsset) {
                setPreview({ src: primaryAsset.url, alt: primaryAsset.name });
              }
            }}
          >
            {primaryAsset ? (
              <>
                <AssetThumb
                  src={primaryAsset.url}
                  alt={primaryAsset.name}
                  fit="contain"
                />
                <span className="pointer-events-none absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/70 bg-white/85 text-zinc-600 opacity-80">
                  <ZoomIn className="h-3.5 w-3.5" />
                </span>
              </>
            ) : uploading || nodeData.uploadStatus === "uploading" ? (
              <BrandMarkFrame size={42} spin />
            ) : (
              <BrandMarkFrame size={42} />
            )}
          </button>

          <div className={glass.actionDock}>
            <GlassIconButton
              disabled={uploading}
              title="上传道具图片"
              onClick={() => inputRef.current?.click()}
            >
              <Plus className="h-4 w-4" />
            </GlassIconButton>
          </div>
        </div>

        {assetIds.length > 1 && (
          <div className="nodrag nopan mb-2 grid grid-cols-4 gap-1.5">
            {galleryAssets.map((asset, index) => {
              if (!asset) return null;
              const assetId = assetIds[index];
              return (
                <button
                  type="button"
                  key={assetId}
                  className="nodrag nopan relative aspect-square overflow-hidden rounded-xl border border-white/70 bg-white/85"
                  title="双击放大预览"
                  onDoubleClick={() =>
                    setPreview({ src: asset.url, alt: asset.name })
                  }
                >
                  <AssetThumb src={asset.url} alt={asset.name} />
                </button>
              );
            })}
          </div>
        )}

        <div className={`${glass.status} ${toneClass}`}>{statusText}</div>
        {nodeData.errorMessage && (
          <div className="mt-1 px-0.5 text-[10px] text-rose-600">
            {nodeData.errorMessage}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          multiple
          className="hidden"
          onChange={(e) => void onUpload(e.target.files)}
        />
      </div>

      <ImageLightbox
        src={preview?.src ?? null}
        alt={preview?.alt}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
