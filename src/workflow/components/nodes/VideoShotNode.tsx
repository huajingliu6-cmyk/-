"use client";

import { useRef, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { Clapperboard, FolderOpen, Upload, ZoomIn } from "lucide-react";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import { BrandMark } from "@/workflow/components/BrandMark";
import { ImageLightbox } from "@/workflow/components/ImageLightbox";
import { VideoPromptPanel } from "@/workflow/components/VideoPromptPanel";
import { GlassChip, glass } from "@/workflow/components/glass-ui";
import { NodePorts } from "@/workflow/components/nodes/NodePorts";
import {
  useAssetById,
  useAssetsByIds,
  useLibraryImageAssets,
} from "@/workflow/hooks/useAssetById";
import { uploadAssetFile } from "@/workflow/lib/upload-asset";
import { useWorkflowStore } from "@/workflow/store";
import type { VideoShotNodeData } from "@/workflow/types";

export function VideoShotNodeView({ id, selected }: NodeProps) {
  const projectId = useWorkflowStore((s) => s.projectId);
  const nodeData = useWorkflowStore(
    (s) =>
      s.document.nodes.find((n) => n.id === id)?.data as
        | VideoShotNodeData
        | undefined,
  );
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const commitNodeAssets = useWorkflowStore((s) => s.commitNodeAssets);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [libraryOpenIntent, setLibraryOpenIntent] = useState(false);
  const [prevSelected, setPrevSelected] = useState(selected);
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(
    null,
  );

  if (selected !== prevSelected) {
    setPrevSelected(selected);
    if (!selected) setLibraryOpenIntent(false);
  }

  const libraryOpen = selected && libraryOpenIntent;

  const resultAsset = useAssetById(nodeData?.resultAssetId);
  const attachedIds = (nodeData?.attachedAssetIds ?? []).slice(0, 4);
  const attachedAssets = useAssetsByIds(attachedIds);
  const libraryAssets = useLibraryImageAssets(selected && libraryOpen);

  if (!nodeData) return null;

  const isPortrait = nodeData.aspectRatio === "9:16";

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
      commitNodeAssets(id, uploaded, {
        attachedAssetIds: [
          ...new Set([
            ...nodeData.attachedAssetIds,
            ...uploaded.map((a) => a.id),
          ]),
        ],
        errorMessage: "",
      });
    } catch (error) {
      updateNodeData(id, {
        errorMessage:
          error instanceof Error ? error.message : "上传失败，请重试",
      });
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const attachFromLibrary = (assetId: string) => {
    updateNodeData(id, {
      attachedAssetIds: [...new Set([...nodeData.attachedAssetIds, assetId])],
    });
    setLibraryOpenIntent(false);
  };

  return (
    <div className="relative">
      <div
        className={`pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 flex -translate-x-1/2 flex-col items-center gap-2 ${
          selected ? "" : "invisible"
        }`}
        aria-hidden={!selected}
      >
        <div className={`pointer-events-auto ${glass.floatBar}`}>
          <GlassChip
            disabled={uploading}
            onClick={() => uploadRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span>上传</span>
          </GlassChip>
          <span className={glass.floatDivider} aria-hidden />
          <GlassChip
            active={libraryOpen}
            onClick={() => setLibraryOpenIntent((v) => !v)}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span>资产库</span>
          </GlassChip>
        </div>

        {libraryOpen && (
          <div
            className={`pointer-events-auto nodrag nopan w-56 ${glass.popover}`}
          >
            <div className="mb-1.5 px-1.5 text-[10px] font-medium text-zinc-500">
              工作台资产库
            </div>
            <div className="max-h-40 space-y-0.5 overflow-auto">
              {libraryAssets.length === 0 ? (
                <div className="px-1.5 py-2 text-[10px] text-zinc-400">
                  暂无可用图片素材
                </div>
              ) : (
                libraryAssets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-white/55"
                    onClick={() => attachFromLibrary(asset.id)}
                  >
                    <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-white/50 bg-white/40">
                      <AssetThumb
                        src={asset.url}
                        alt={asset.name}
                      />
                    </div>
                    <span className="truncate text-[11px] text-zinc-700">
                      {asset.name}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* 外框宽度固定，避免切换画幅时触发 React Flow 尺寸回写闪烁 */}
      <div
        className={`relative w-[224px] p-2 ${
          selected ? glass.cardSelected : glass.card
        }`}
      >
        <NodePorts />

        <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-zinc-800">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/80 bg-white/90">
            <Clapperboard className="h-3.5 w-3.5 text-zinc-600" />
          </span>
          <span className="truncate text-[12px] font-semibold tracking-tight">
            {nodeData.title || `视频 · 镜头 ${nodeData.shotNumber}`}
          </span>
        </div>

        <div
          className={`relative mx-auto overflow-hidden rounded-[16px] bg-zinc-200/40 ${
            isPortrait ? "aspect-[9/16] w-[156px]" : "aspect-video w-full"
          }`}
        >
          {resultAsset ? (
            <button
              type="button"
              className="nodrag nopan absolute inset-0"
              title="双击放大预览"
              onDoubleClick={() =>
                setPreview({ src: resultAsset.url, alt: resultAsset.name })
              }
            >
              <AssetThumb
                src={resultAsset.url}
                alt={resultAsset.name}
                fit="contain"
              />
              <span className="pointer-events-none absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/70 bg-white/85 text-zinc-600 opacity-80">
                <ZoomIn className="h-3.5 w-3.5" />
              </span>
            </button>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-[#e8eaee]/55">
              <BrandMark
                size={36}
                spin={nodeData.status === "processing" || uploading}
              />
            </div>
          )}
          {nodeData.status === "processing" && resultAsset && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/30">
              <BrandMark size={32} spin />
            </div>
          )}
        </div>

        {attachedIds.length > 0 && (
          <div className="nodrag nopan mt-1.5 flex gap-1.5 overflow-x-auto px-0.5">
            {attachedAssets.map((asset, index) => {
              if (!asset) return null;
              const assetId = attachedIds[index];
              return (
                <button
                  type="button"
                  key={assetId}
                  className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-white/70 bg-white/90"
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

        {nodeData.errorMessage && (
          <div className="mt-1 text-[10px] text-rose-600">
            {nodeData.errorMessage}
          </div>
        )}

        <input
          ref={uploadRef}
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
        <VideoPromptPanel nodeId={id} />
      </div>

      <ImageLightbox
        src={preview?.src ?? null}
        alt={preview?.alt}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
