"use client";

import { useMemo, useRef, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import {
  Clapperboard,
  FolderOpen,
  Play,
  Upload,
} from "lucide-react";
import { BrandMark } from "@/workflow/components/BrandMark";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import { ImageLightbox } from "@/workflow/components/ImageLightbox";
import { VideoPromptPanel } from "@/workflow/components/VideoPromptPanel";
import { VideoResultDrawer } from "@/workflow/components/VideoResultDrawer";
import { GlassChip, glass } from "@/workflow/components/glass-ui";
import { NodePorts } from "@/workflow/components/nodes/NodePorts";
import { useAssetById, useAssetsByIds, useLibraryImageAssets } from "@/workflow/hooks/useAssetById";
import { useWorkflowNodeData } from "@/workflow/hooks/useWorkflowNodeData";
import { uploadAssetFile } from "@/workflow/lib/upload-asset";
import { buildGeneratedVideoContentUrl } from "@/workflow/lib/generated-video-url";
import { useWorkflowStore } from "@/workflow/store";
import type { VideoShotNodeData } from "@/workflow/types";
import type { GenerationRecord } from "@/video-generation/types";
import { classifyGenerationResult } from "@/video-generation/classify-generation-result";
import {
  buildGenerationParameterComparisonView,
  formatParameterComparisonNodeSummary,
} from "@/video-generation/parameter-comparison-view";
import { DEMO_PROJECT_ID } from "@/workflow/default-workflow";

export function VideoShotNodeView({ id, selected }: NodeProps) {
  const projectId = useWorkflowStore((s) => s.projectId) || DEMO_PROJECT_ID;
  const nodeData = useWorkflowNodeData<VideoShotNodeData>(id);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const commitNodeAssets = useWorkflowStore((s) => s.commitNodeAssets);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [libraryOpenIntent, setLibraryOpenIntent] = useState(false);
  const [prevSelected, setPrevSelected] = useState(selected);
  const [imagePreview, setImagePreview] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [drawerGeneration, setDrawerGeneration] =
    useState<GenerationRecord | null>(null);
  const [summaryGeneration, setSummaryGeneration] =
    useState<GenerationRecord | null>(null);

  if (selected !== prevSelected) {
    setPrevSelected(selected);
    if (!selected) {
      setLibraryOpenIntent(false);
      setResultOpen(false);
    }
  }

  const libraryOpen = selected && libraryOpenIntent;

  const resultAsset = useAssetById(nodeData?.resultAssetId);
  const attachedIds = (nodeData?.attachedAssetIds ?? []).slice(0, 4);
  const attachedAssets = useAssetsByIds(attachedIds);
  const libraryAssets = useLibraryImageAssets(selected && libraryOpen);

  const parameterSummary = useMemo(() => {
    const record = summaryGeneration ?? drawerGeneration;
    if (!record) {
      if (resultAsset && Boolean(resultAsset.metadata?.mock)) {
        return "Mock 流程验证";
      }
      return null;
    }
    if (
      nodeData?.activeGenerationId &&
      record.id !== nodeData.activeGenerationId &&
      record.localVideoAssetId !== resultAsset?.id &&
      record.resultAsset?.id !== resultAsset?.id
    ) {
      if (resultAsset && Boolean(resultAsset.metadata?.mock)) {
        return "Mock 流程验证";
      }
      return null;
    }
    const view = buildGenerationParameterComparisonView(record);
    return formatParameterComparisonNodeSummary(view);
  }, [
    summaryGeneration,
    drawerGeneration,
    resultAsset,
    nodeData?.activeGenerationId,
  ]);

  if (!nodeData) return null;

  const isPortrait = nodeData.aspectRatio === "9:16";
  const classified = classifyGenerationResult({
    generation: drawerGeneration,
    asset: resultAsset,
  });

  const transferFailed =
    drawerGeneration?.status === "resultTransferFailed" ||
    (nodeData.status === "failed" &&
      Boolean(nodeData.activeGenerationId) &&
      /转存/.test(nodeData.errorMessage || ""));

  const isVideoAsset =
    resultAsset?.assetType === "generatedVideo" ||
    Boolean(resultAsset?.mimeType.startsWith("video/"));

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

  const openResultDrawer = async (generation?: GenerationRecord | null) => {
    setResultOpen(true);
    if (generation) {
      setDrawerGeneration(generation);
      return;
    }
    const generationId = nodeData.activeGenerationId;
    if (!generationId) {
      setDrawerGeneration(null);
      return;
    }
    try {
      const res = await fetch(`/api/generations/${generationId}`);
      const payload = (await res.json()) as {
        generation?: GenerationRecord;
      };
      setDrawerGeneration(payload.generation ?? null);
    } catch {
      setDrawerGeneration(null);
    }
  };

  const onRetryTransfer = async () => {
    const generationId = nodeData.activeGenerationId;
    if (!generationId) return;
    try {
      const res = await fetch(`/api/generations/${generationId}/transfer`, {
        method: "POST",
      });
      const payload = (await res.json()) as {
        generation?: GenerationRecord;
        message?: string;
      };
      if (!res.ok || !payload.generation) {
        updateNodeData(id, {
          errorMessage: payload.message ?? "转存失败",
          status: "failed",
        });
        setDrawerGeneration(payload.generation ?? null);
        return;
      }
      setDrawerGeneration(payload.generation);
      if (payload.generation.resultAsset) {
        commitNodeAssets(id, [payload.generation.resultAsset], {
          status: "completed",
          progress: 100,
          resultAssetId: payload.generation.resultAsset.id,
          errorMessage: "",
        });
      }
    } catch (error) {
      updateNodeData(id, {
        errorMessage:
          error instanceof Error ? error.message : "转存失败，请重试",
      });
    }
  };

  const canPlay =
    classified.canPlay ||
    (isVideoAsset &&
      resultAsset?.assetType === "generatedVideo" &&
      resultAsset.mimeType === "video/mp4");

  const invalidVideo =
    resultAsset &&
    !isVideoAsset &&
    nodeData.status === "completed";

  const previewUrl =
    canPlay && resultAsset
      ? buildGeneratedVideoContentUrl({
          assetId: resultAsset.id,
          generationId: nodeData.activeGenerationId || null,
          projectId,
          shotNumber: nodeData.shotNumber,
        })
      : null;

  return (
    <div className="group/node relative">
      <div
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 flex -translate-x-1/2 flex-col items-center gap-2 opacity-0 transition-opacity duration-150 group-hover/node:pointer-events-auto group-hover/node:opacity-100"
        aria-hidden
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
                      <AssetThumb src={asset.url} alt={asset.name} />
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
          {invalidVideo ? (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/90 px-2 text-center">
              <span className="text-[10px] leading-snug text-rose-300">
                结果不是有效的生成视频资产
              </span>
            </div>
          ) : transferFailed ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900/90 px-2 text-center">
              <span className="text-[10px] text-amber-200">
                视频已生成，但本地转存失败
              </span>
              <button
                type="button"
                className="nodrag nopan rounded-lg bg-amber-400 px-2 py-1 text-[10px] font-medium text-zinc-900"
                onClick={() => void onRetryTransfer()}
              >
                重试转存
              </button>
            </div>
          ) : canPlay && previewUrl ? (
            <>
              {/* 封面：静音首帧预览，无控件、无文案 */}
              <video
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                src={`${previewUrl}#t=0.1`}
                muted
                playsInline
                preload="metadata"
                aria-hidden
              />
              <button
                type="button"
                className="nodrag nopan absolute inset-0 flex items-center justify-center bg-black/25 transition hover:bg-black/35"
                title="播放"
                aria-label="播放"
                onClick={() => void openResultDrawer()}
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white shadow-lg ring-1 ring-white/30">
                  <Play className="h-5 w-5 fill-current" strokeWidth={0} />
                </span>
              </button>
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-[#e8eaee]/55">
              <BrandMark
                size={36}
                spin={nodeData.status === "processing" || uploading}
              />
            </div>
          )}
          {nodeData.status === "processing" && canPlay && (
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
                    setImagePreview({ src: asset.url, alt: asset.name })
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

        {parameterSummary && (
          <button
            type="button"
            className="nodrag nopan mt-1 w-full truncate rounded-lg px-1 py-0.5 text-left text-[10px] text-zinc-600 hover:bg-white/50 hover:text-zinc-800"
            title={parameterSummary}
            onClick={() => void openResultDrawer(summaryGeneration ?? drawerGeneration)}
          >
            {parameterSummary}
          </button>
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
        <VideoPromptPanel
          nodeId={id}
          onOpenVideoResult={(generation) => {
            void openResultDrawer(generation);
          }}
          onGenerationSnapshot={(generation) => {
            setSummaryGeneration(generation);
          }}
        />
      </div>

      <ImageLightbox
        src={imagePreview?.src ?? null}
        alt={imagePreview?.alt}
        onClose={() => setImagePreview(null)}
      />

      <VideoResultDrawer
        open={resultOpen}
        onClose={() => setResultOpen(false)}
        generation={drawerGeneration}
        asset={resultAsset ?? null}
        projectId={projectId}
        shotNumber={nodeData.shotNumber}
        onRetryTransfer={() => void onRetryTransfer()}
      />
    </div>
  );
}
