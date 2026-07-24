"use client";

import { useRef, useState } from "react";
import {
  ArrowUp,
  BookOpen,
  ChartNoAxesColumn,
  Maximize2,
  Plus,
  Smile,
  Wand2,
} from "lucide-react";
import {
  GlassChip,
  GlassIconButton,
  GlassSendButton,
  glass,
} from "@/workflow/components/glass-ui";
import {
  GenerationHistoryButton,
  GenerationHistoryPopover,
} from "@/workflow/components/GenerationHistoryPopover";
import { PromptReferenceChips } from "@/workflow/components/PromptReferenceChips";
import { MentionTextarea } from "@/workflow/components/MentionTextarea";
import { useDebouncedCommit } from "@/workflow/hooks/useDebouncedCommit";
import { prependGenerationHistory } from "@/workflow/lib/generation-history";
import {
  requestCharacterAppearance,
  requestCharacterVoice,
} from "@/workflow/lib/request-character-generation";
import { uploadAssetFile } from "@/workflow/lib/upload-asset";
import { useWorkflowStore } from "@/workflow/store";
import type { CharacterNodeData, CharacterVariant } from "@/workflow/types";

type GenMode = "appearance" | "voice";

type Props = {
  nodeId: string;
};

const STYLE_OPTIONS = [
  { value: "", label: "风格" },
  { value: "realistic", label: "写实" },
  { value: "anime", label: "动漫" },
  { value: "cinematic", label: "电影感" },
  { value: "illustration", label: "插画" },
];

const IMAGE_MODEL_OPTIONS = [
  { value: "AnyCook", label: "AnyCook" },
  { value: "AnyCook Pro", label: "AnyCook Pro" },
];

const ASPECT_OPTIONS = [
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
];

const RESOLUTION_OPTIONS = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

function selectedVariant(data: CharacterNodeData): CharacterVariant | undefined {
  return (
    data.variants.find((v) => v.id === data.selectedVariantId) ??
    data.variants.find((v) => v.id === data.primaryVariantId) ??
    data.variants[0]
  );
}

function normalizeAspect(value: string): string {
  return value === "16:9" ? "16:9" : "9:16";
}

function normalizeResolution(value: string): string {
  const hit = RESOLUTION_OPTIONS.find((opt) => opt.value === value);
  if (hit) return hit.value;
  if (value.includes("4K") || value.includes("3840") || value.includes("2160"))
    return "4K";
  if (
    value.includes("2K") ||
    value.includes("3K") ||
    value.includes("2560") ||
    value.includes("1440")
  ) {
    return "2K";
  }
  return "1K";
}

export function CharacterPromptPanel({ nodeId }: Props) {
  const projectId = useWorkflowStore((s) => s.projectId);
  const node = useWorkflowStore((s) =>
    s.document.nodes.find((n) => n.id === nodeId),
  );
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const commitNodeAssets = useWorkflowStore((s) => s.commitNodeAssets);
  const [mode, setMode] = useState<GenMode>("appearance");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const data =
    node?.type === "character" ? (node.data as CharacterNodeData) : null;
  const storePrompt = data
    ? mode === "appearance"
      ? data.appearancePrompt
      : data.voicePrompt
    : "";

  const { draft, setValue, flush } = useDebouncedCommit(
    storePrompt,
    (value) => {
      if (mode === "appearance") {
        updateNodeData(nodeId, {
          appearancePrompt: value,
          description: value,
        });
      } else {
        updateNodeData(nodeId, { voicePrompt: value });
      }
    },
  );

  if (!data) return null;

  const variant = selectedVariant(data);
  const busy =
    submitting ||
    uploading ||
    data.appearanceStatus === "processing" ||
    data.voiceStatus === "processing" ||
    data.uploadStatus === "uploading";
  const imageModel = data.imageModel || "AnyCook";
  const stylePreset = data.stylePreset || "";
  const aspectRatio = normalizeAspect(data.aspectRatio || "9:16");
  const resolution = normalizeResolution(data.resolution || "2K");
  const credit = 1;
  const referenceCount = variant
    ? new Set([
        ...(variant.primaryAssetId ? [variant.primaryAssetId] : []),
        ...variant.referenceAssetIds,
      ]).size
    : 0;

  const switchMode = (next: GenMode) => {
    flush();
    setMode(next);
    setNotice("");
    setHistoryOpen(false);
  };

  const historyIds =
    mode === "appearance"
      ? (data?.generationHistoryIds ?? [])
      : (data?.voiceHistoryIds ?? []);
  const activeHistoryId =
    mode === "appearance"
      ? (variant?.primaryAssetId ?? "")
      : (data?.voiceAssetId ?? "");

  const onSelectHistory = (assetId: string) => {
    if (!data) return;
    if (mode === "appearance") {
      const variantId = data.selectedVariantId || data.primaryVariantId;
      updateNodeData(nodeId, {
        variants: data.variants.map((v) =>
          v.id === variantId
            ? {
                ...v,
                primaryAssetId: assetId,
                referenceAssetIds: [
                  ...new Set([...v.referenceAssetIds, assetId]),
                ],
              }
            : v,
        ),
        appearanceStatus: "completed",
        uploadStatus: "ready",
        errorMessage: "",
      });
      setNotice("已切换到历史外貌生成");
    } else {
      updateNodeData(nodeId, {
        voiceAssetId: assetId,
        voiceStatus: "completed",
        errorMessage: "",
      });
      setNotice("已切换到历史声音生成");
    }
  };

  const onUploadReference = async (files: FileList | null) => {
    if (!files?.length || !variant) {
      setNotice("请先选择角色形象后再上传参考文件");
      return;
    }
    setUploading(true);
    setNotice("");
    updateNodeData(nodeId, { uploadStatus: "uploading", errorMessage: "" });
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
      commitNodeAssets(nodeId, uploaded, {
        uploadStatus: "ready",
        appearanceStatus: "completed",
        errorMessage: "",
        variants: data.variants.map((v) =>
          v.id === variant.id
            ? {
                ...v,
                referenceAssetIds: [
                  ...new Set([...v.referenceAssetIds, ...newIds]),
                ],
                primaryAssetId: v.primaryAssetId || newIds[0] || "",
              }
            : v,
        ),
      });
      setNotice(`已上传 ${uploaded.length} 个参考文件`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "参考文件上传失败，请重试";
      updateNodeData(nodeId, {
        uploadStatus: "error",
        errorMessage: message,
      });
      setNotice(message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onOptimizePrompt = () => {
    const base = flush().trim();
    if (!base) {
      setNotice(
        mode === "appearance"
          ? "请先填写外貌描述，再优化提示词"
          : "请先填写声音描述，再优化提示词",
      );
      return;
    }
    const next =
      mode === "appearance"
        ? `${base}。人物面部完整入镜，五官清晰，构图稳定，光影自然。`
        : `${base}。音色稳定，吐字清晰，情绪自然。`;
    setValue(next);
    if (mode === "appearance") {
      updateNodeData(nodeId, {
        appearancePrompt: next,
        description: next,
      });
    } else {
      updateNodeData(nodeId, { voicePrompt: next });
    }
    setNotice("已附加基础优化后缀（本地规则，非外部模型）");
  };

  const onShowReferences = () => {
    setNotice(
      referenceCount > 0
        ? `当前形象已有 ${referenceCount} 个参考文件；也可连线其他节点作为参考`
        : "暂无参考文件。点击 + 上传，或从左侧资产库拖入",
    );
  };

  const onGenerate = async () => {
    const trimmed = flush().trim();
    if (!trimmed) {
      setNotice(
        mode === "appearance" ? "请先描述角色外貌" : "请先描述角色声音",
      );
      return;
    }

    setSubmitting(true);
    setNotice("");
    updateNodeData(nodeId, {
      errorMessage: "",
      ...(mode === "appearance"
        ? {
            appearanceStatus: "processing" as const,
            imageModel,
            stylePreset,
            aspectRatio,
            resolution,
          }
        : { voiceStatus: "processing" as const }),
    });

    try {
      if (mode === "appearance") {
        const result = await requestCharacterAppearance({
          projectId,
          characterNodeId: nodeId,
          characterName: data.characterName || data.title,
          prompt: trimmed,
          model: imageModel,
          stylePreset,
          aspectRatio,
          resolution,
        });
        const variantId = data.selectedVariantId || data.primaryVariantId;
        commitNodeAssets(nodeId, [result.asset], {
          appearanceStatus: "completed",
          uploadStatus: "ready",
          errorMessage: "",
          generationHistoryIds: prependGenerationHistory(
            data.generationHistoryIds,
            result.asset.id,
          ),
          variants: data.variants.map((v) =>
            v.id === variantId
              ? {
                  ...v,
                  primaryAssetId: result.asset.id,
                  referenceAssetIds: [
                    ...new Set([...v.referenceAssetIds, result.asset.id]),
                  ],
                }
              : v,
          ),
        });
        setNotice(result.notice);
        setHistoryOpen(true);
      } else {
        const result = await requestCharacterVoice({
          projectId,
          characterNodeId: nodeId,
          characterName: data.characterName || data.title,
          prompt: trimmed,
        });
        commitNodeAssets(nodeId, [result.asset], {
          voiceAssetId: result.asset.id,
          voiceStatus: "completed",
          errorMessage: "",
          voiceHistoryIds: prependGenerationHistory(
            data.voiceHistoryIds,
            result.asset.id,
          ),
        });
        setNotice(result.notice);
        setHistoryOpen(true);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "生成失败，请重试";
      updateNodeData(nodeId, {
        errorMessage: message,
        ...(mode === "appearance"
          ? { appearanceStatus: "failed" as const }
          : { voiceStatus: "failed" as const }),
      });
      setNotice(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={`nodrag nopan nowheel w-[min(520px,92vw)] ${glass.panel}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <PromptReferenceChips nodeId={nodeId} />
      <div className="relative mb-2.5">
        <MentionTextarea
          className="pr-8"
          placeholder={
            mode === "appearance"
              ? "描述你想要生成的角色外貌，键入 @ 引用素材…"
              : "描述你想要生成的角色声音，键入 @ 引用素材…"
          }
          value={draft}
          disabled={busy}
          onChange={setValue}
          onBlur={() => flush()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void onGenerate();
            }
          }}
        />
        <Maximize2 className="pointer-events-none absolute right-3 top-3 h-3.5 w-3.5 text-zinc-400" />
      </div>

      <div className="mb-2 flex items-center gap-1.5">
        <div className={glass.floatBar}>
          <GlassChip
            active={mode === "appearance"}
            disabled={busy}
            onClick={() => switchMode("appearance")}
          >
            外貌
          </GlassChip>
          <GlassChip
            active={mode === "voice"}
            disabled={busy}
            onClick={() => switchMode("voice")}
          >
            声音
          </GlassChip>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {mode === "appearance" ? (
          <>
            <GlassIconButton
              disabled={busy}
              title="上传参考文件"
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus className="h-3.5 w-3.5" />
            </GlassIconButton>

            <label className={glass.selectWrap} title="风格">
              <Smile className="h-3 w-3 shrink-0 text-zinc-500" />
              <select
                className="nodrag nopan max-w-[5.5rem] bg-transparent outline-none"
                value={stylePreset}
                disabled={busy}
                onChange={(e) =>
                  updateNodeData(nodeId, { stylePreset: e.target.value })
                }
              >
                {STYLE_OPTIONS.map((opt) => (
                  <option key={opt.value || "none"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={glass.selectWrap} title="生图模型">
              <ChartNoAxesColumn className="h-3 w-3 shrink-0 text-zinc-500" />
              <select
                className="nodrag nopan max-w-[7rem] bg-transparent outline-none"
                value={
                  IMAGE_MODEL_OPTIONS.some((o) => o.value === imageModel)
                    ? imageModel
                    : "AnyCook"
                }
                disabled={busy}
                onChange={(e) =>
                  updateNodeData(nodeId, { imageModel: e.target.value })
                }
              >
                {IMAGE_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <select
              className={glass.select}
              value={aspectRatio}
              disabled={busy}
              title="比例"
              onChange={(e) =>
                updateNodeData(nodeId, {
                  aspectRatio: normalizeAspect(e.target.value),
                })
              }
            >
              {ASPECT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              className={glass.select}
              value={resolution}
              disabled={busy}
              title="分辨率"
              onChange={(e) =>
                updateNodeData(nodeId, {
                  resolution: normalizeResolution(e.target.value),
                })
              }
            >
              {RESOLUTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className={`${glass.status} text-zinc-600`}>角色声音生成</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {mode === "appearance" && (
            <GlassIconButton
              title="查看参考素材"
              disabled={busy}
              onClick={onShowReferences}
            >
              <BookOpen className="h-3.5 w-3.5" />
            </GlassIconButton>
          )}
          <GenerationHistoryButton
            open={historyOpen}
            historyIds={historyIds}
            disabled={busy}
            onToggle={() => setHistoryOpen((v) => !v)}
          />
          <GlassIconButton
            title="优化提示词"
            disabled={busy}
            onClick={onOptimizePrompt}
          >
            <Wand2 className="h-3.5 w-3.5" />
          </GlassIconButton>
          <span className={glass.credit}>+ {credit}</span>
          <GlassSendButton
            busy={busy}
            title={
              busy ? "生成中…" : mode === "appearance" ? "生成外貌" : "生成声音"
            }
            onClick={() => void onGenerate()}
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
          </GlassSendButton>
        </div>
      </div>

      <GenerationHistoryPopover
        open={historyOpen}
        historyIds={historyIds}
        activeAssetId={activeHistoryId}
        onSelect={onSelectHistory}
        emptyHint={
          mode === "appearance"
            ? "暂无外貌历史。生成成功后可在此切换回看。"
            : "暂无声音历史。生成成功后可在此切换回看。"
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        multiple
        className="hidden"
        onChange={(e) => void onUploadReference(e.target.files)}
      />

      {notice && (
        <div className="mt-2 px-0.5 text-[10px] leading-relaxed text-zinc-500">
          {notice}
        </div>
      )}
    </div>
  );
}
