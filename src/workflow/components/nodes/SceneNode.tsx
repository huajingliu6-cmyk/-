"use client";

import { useRef, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { Mountain, Plus, ZoomIn } from "lucide-react";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import { BrandMarkFrame } from "@/workflow/components/BrandMark";
import { ImageLightbox } from "@/workflow/components/ImageLightbox";
import { ScenePromptPanel } from "@/workflow/components/ScenePromptPanel";
import { GlassIconButton, glass } from "@/workflow/components/glass-ui";
import { NodePorts } from "@/workflow/components/nodes/NodePorts";
import { useAssetById, useAssetsByIds } from "@/workflow/hooks/useAssetById";
import { uploadAssetFile } from "@/workflow/lib/upload-asset";
import { useWorkflowStore } from "@/workflow/store";
import type { SceneNodeData, SceneViewpoint } from "@/workflow/types";

export function SceneNodeView({ id, selected }: NodeProps) {
  const projectId = useWorkflowStore((s) => s.projectId);
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | SceneNodeData
        | undefined,
  );
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const commitNodeAssets = useWorkflowStore((s) => s.commitNodeAssets);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(
    null,
  );

  const viewpointAssetIds = (nodeData?.viewpoints ?? [])
    .map((vp) => vp.assetId)
    .filter(Boolean);
  const primaryAsset = useAssetById(nodeData?.primaryAssetId);
  const viewpointAssets = useAssetsByIds(viewpointAssetIds.slice(0, 4));

  if (!nodeData) return null;

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded = [];
      const newViewpoints: SceneViewpoint[] = [];
      for (const file of Array.from(files)) {
        const asset = await uploadAssetFile(file, {
          assetType: "sceneImage",
          projectId,
          name: file.name,
        });
        uploaded.push(asset);
        newViewpoints.push({
          id: `vp-${crypto.randomUUID().slice(0, 8)}`,
          tag: "custom",
          label: file.name,
          assetId: asset.id,
        });
      }

      const viewpoints = [...nodeData.viewpoints, ...newViewpoints];
      commitNodeAssets(id, uploaded, {
        viewpoints,
        referenceAssetIds: viewpoints.map((vp) => vp.assetId),
        primaryAssetId:
          nodeData.primaryAssetId || newViewpoints[0]?.assetId || "",
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

  const statusText =
    nodeData.generationStatus === "processing" || uploading
      ? "生成 / 上传中…"
      : primaryAsset
        ? "场景参考 已就绪"
        : "场景参考 待补充";

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
            <Mountain className="h-3.5 w-3.5 text-zinc-600" />
          </span>
          <span className="truncate text-[13px] font-semibold tracking-tight">
            {nodeData.sceneName || nodeData.title || "未命名场景"}
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
            ) : uploading || nodeData.generationStatus === "processing" ? (
              <BrandMarkFrame size={42} spin />
            ) : (
              <BrandMarkFrame size={42} />
            )}
          </button>

          <div className={glass.actionDock}>
            <GlassIconButton
              disabled={uploading}
              title="上传场景图片"
              onClick={() => inputRef.current?.click()}
            >
              <Plus className="h-4 w-4" />
            </GlassIconButton>
          </div>
        </div>

        {viewpointAssetIds.length > 1 && (
          <div className="nodrag nopan mb-2 grid grid-cols-4 gap-1.5">
            {viewpointAssets.map((asset, index) => {
              if (!asset) return null;
              const assetId = viewpointAssetIds[index];
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
          <div className="mt-1 text-center text-[10px] text-rose-600">
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

      <div
        className={`absolute left-1/2 top-full z-20 mt-2.5 -translate-x-1/2 ${
          selected ? "" : "invisible pointer-events-none"
        }`}
        aria-hidden={!selected}
      >
        <ScenePromptPanel nodeId={id} />
      </div>

      <ImageLightbox
        src={preview?.src ?? null}
        alt={preview?.alt}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
