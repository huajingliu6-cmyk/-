"use client";

import { useRef, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { AudioLines, Plus, UserRound, ZoomIn } from "lucide-react";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import { BrandMarkFrame } from "@/workflow/components/BrandMark";
import { CharacterPromptPanel } from "@/workflow/components/CharacterPromptPanel";
import { GlassIconButton, glass } from "@/workflow/components/glass-ui";
import { ImageLightbox } from "@/workflow/components/ImageLightbox";
import { NodePorts } from "@/workflow/components/nodes/NodePorts";
import { useAssetById } from "@/workflow/hooks/useAssetById";
import { useWorkflowNodeData } from "@/workflow/hooks/useWorkflowNodeData";
import { uploadAssetFile } from "@/workflow/lib/upload-asset";
import { useWorkflowStore } from "@/workflow/store";
import type { CharacterNodeData, CharacterVariant } from "@/workflow/types";

function selectedVariant(data: CharacterNodeData): CharacterVariant | undefined {
  return (
    data.variants.find((v) => v.id === data.selectedVariantId) ??
    data.variants.find((v) => v.id === data.primaryVariantId) ??
    data.variants[0]
  );
}

function statusLabel(data: CharacterNodeData, hasImage: boolean): {
  text: string;
  tone: "pending" | "ready" | "busy" | "error";
} {
  if (data.errorMessage) return { text: data.errorMessage, tone: "error" };
  if (
    data.appearanceStatus === "processing" ||
    data.voiceStatus === "processing" ||
    data.uploadStatus === "uploading"
  ) {
    return { text: "生成 / 上传中…", tone: "busy" };
  }
  if (hasImage) return { text: "基础形象 已就绪", tone: "ready" };
  return { text: "基础形象 待补充", tone: "pending" };
}

export function CharacterNodeView({ id, selected }: NodeProps) {
  const projectId = useWorkflowStore((s) => s.projectId);
  const nodeData = useWorkflowNodeData<CharacterNodeData>(id);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const commitNodeAssets = useWorkflowStore((s) => s.commitNodeAssets);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"image" | "voice" | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const variant = nodeData ? selectedVariant(nodeData) : undefined;
  const primaryAsset = useAssetById(variant?.primaryAssetId);
  const voiceAsset = useAssetById(nodeData?.voiceAssetId);

  if (!nodeData) return null;

  const status = busy
    ? { text: "生成 / 上传中…", tone: "busy" as const }
    : statusLabel(nodeData, Boolean(primaryAsset));

  const attachImage = async (files: FileList | null) => {
    if (!files?.length || !variant) return;
    setBusy("image");
    try {
      const uploaded = [];
      for (const file of Array.from(files)) {
        uploaded.push(
          await uploadAssetFile(file, {
            assetType: "characterImage",
            projectId,
            name: file.name,
          }),
        );
      }
      const newIds = uploaded.map((a) => a.id);
      commitNodeAssets(id, uploaded, {
        uploadStatus: "ready",
        appearanceStatus: "completed",
        errorMessage: "",
        variants: nodeData.variants.map((v) =>
          v.id === variant.id
            ? {
                ...v,
                referenceAssetIds: [
                  ...new Set([...v.referenceAssetIds, ...newIds]),
                ],
                primaryAssetId: newIds[0] || v.primaryAssetId,
              }
            : v,
        ),
      });
    } catch (error) {
      updateNodeData(id, {
        uploadStatus: "error",
        errorMessage:
          error instanceof Error ? error.message : "图片上传失败，请重试",
      });
    } finally {
      setBusy(null);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const attachVoice = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("voice");
    try {
      const file = files[0];
      const asset = await uploadAssetFile(file, {
        assetType: "audio",
        projectId,
        name: file.name,
      });
      commitNodeAssets(id, [asset], {
        voiceAssetId: asset.id,
        voiceStatus: "completed",
        errorMessage: "",
      });
    } catch (error) {
      updateNodeData(id, {
        voiceStatus: "failed",
        errorMessage:
          error instanceof Error ? error.message : "声音上传失败，请重试",
      });
    } finally {
      setBusy(null);
      if (voiceInputRef.current) voiceInputRef.current.value = "";
    }
  };

  const toneClass =
    status.tone === "ready"
      ? "text-emerald-700"
      : status.tone === "busy"
        ? "text-sky-700"
        : status.tone === "error"
          ? "text-rose-600"
          : "text-amber-700";

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
            <UserRound className="h-3.5 w-3.5 text-zinc-600" />
          </span>
          <span className="truncate text-[13px] font-semibold tracking-tight">
            {nodeData.characterName || nodeData.title || "未命名角色"}
          </span>
        </div>

        <div className="relative mb-2 overflow-hidden rounded-[16px]">
          <button
            type="button"
            className="nodrag nopan relative flex aspect-square w-full items-center justify-center overflow-hidden bg-[#e8eaee]/70"
            disabled={busy === "image"}
            title={primaryAsset ? "双击放大预览" : "请使用下方 + 上传图片"}
            onDoubleClick={() => {
              if (primaryAsset) setPreviewOpen(true);
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
            ) : busy === "image" ||
              nodeData.appearanceStatus === "processing" ||
              nodeData.uploadStatus === "uploading" ? (
              <BrandMarkFrame size={42} spin />
            ) : (
              <BrandMarkFrame size={42} />
            )}
          </button>

          <div className={glass.actionDock}>
            <GlassIconButton
              active={Boolean(voiceAsset)}
              disabled={busy === "voice"}
              title="上传角色声音"
              onClick={() => voiceInputRef.current?.click()}
            >
              <AudioLines className="h-4 w-4" />
            </GlassIconButton>
            <GlassIconButton
              disabled={busy === "image"}
              title="上传参考文件"
              onClick={() => imageInputRef.current?.click()}
            >
              <Plus className="h-4 w-4" />
            </GlassIconButton>
          </div>
        </div>

        <div className={`${glass.status} ${toneClass}`}>{status.text}</div>
        {voiceAsset && (
          <div className="mt-1 truncate px-1 text-center text-[10px] text-zinc-500">
            声音 · {voiceAsset.name}
          </div>
        )}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={(e) => void attachImage(e.target.files)}
        />
        <input
          ref={voiceInputRef}
          type="file"
          accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac"
          className="hidden"
          onChange={(e) => void attachVoice(e.target.files)}
        />
      </div>

      <div
        className={`absolute left-1/2 top-full z-20 mt-2.5 -translate-x-1/2 ${
          selected ? "" : "invisible pointer-events-none"
        }`}
        aria-hidden={!selected}
      >
        <CharacterPromptPanel nodeId={id} />
      </div>

      <ImageLightbox
        src={previewOpen && primaryAsset ? primaryAsset.url : null}
        alt={primaryAsset?.name}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}
