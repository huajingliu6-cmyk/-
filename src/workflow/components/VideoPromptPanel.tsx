"use client";

import { useState } from "react";
import { ArrowUp, Maximize2, Wand2 } from "lucide-react";
import {
  GlassIconButton,
  GlassSendButton,
  glass,
} from "@/workflow/components/glass-ui";
import {
  DurationCombobox,
  clampVideoDuration,
} from "@/workflow/components/DurationCombobox";
import {
  GenerationHistoryButton,
  GenerationHistoryPopover,
} from "@/workflow/components/GenerationHistoryPopover";
import { PromptReferenceChips } from "@/workflow/components/PromptReferenceChips";
import { MentionTextarea } from "@/workflow/components/MentionTextarea";
import { useDebouncedCommit } from "@/workflow/hooks/useDebouncedCommit";
import { prependGenerationHistory } from "@/workflow/lib/generation-history";
import { requestVideoShotGeneration } from "@/workflow/lib/request-video-shot-generation";
import { useWorkflowStore } from "@/workflow/store";
import type { VideoShotNodeData } from "@/workflow/types";

const ASPECT_OPTIONS = [
  { value: "9:16", label: "9:16（竖屏）" },
  { value: "16:9", label: "16:9（横屏）" },
];

const RESOLUTION_OPTIONS = [
  { value: "480P", label: "480P" },
  { value: "720P", label: "720P" },
  { value: "1080P", label: "1080P" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const REFERENCE_OPTIONS = [
  { value: "startEndFrame", label: "首尾帧" },
  { value: "omni", label: "全能参考" },
  { value: "video", label: "视频参考" },
];

type Props = {
  nodeId: string;
};

function normalizeAspect(value: string): string {
  return value === "16:9" ? "16:9" : "9:16";
}

function normalizeResolution(value: string): string {
  const hit = RESOLUTION_OPTIONS.find((opt) => opt.value === value);
  if (hit) return hit.value;
  if (value.includes("480")) return "480P";
  if (value.includes("1080") || value.includes("1920")) return "1080P";
  if (value.includes("2K") || value.includes("2560") || value.includes("1440"))
    return "2K";
  if (value.includes("4K") || value.includes("3840") || value.includes("2160"))
    return "4K";
  return "720P";
}

function normalizeReferenceMode(value: string): string {
  if (value === "startEndFrame" || value === "omni" || value === "video") {
    return value;
  }
  if (value === "full" || value === "style" || value === "composition") {
    return "omni";
  }
  return "omni";
}

export function VideoPromptPanel({ nodeId }: Props) {
  const projectId = useWorkflowStore((s) => s.projectId);
  const node = useWorkflowStore((s) =>
    s.document.nodes.find((n) => n.id === nodeId),
  );
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const commitNodeAssets = useWorkflowStore((s) => s.commitNodeAssets);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const data =
    node?.type === "videoShot" ? (node.data as VideoShotNodeData) : null;
  const storePrompt = data?.generationInstruction ?? "";

  const { draft, setValue, flush } = useDebouncedCommit(storePrompt, (value) => {
    updateNodeData(nodeId, { generationInstruction: value });
  });

  if (!data) return null;

  const busy = submitting || data.status === "processing";
  const duration = clampVideoDuration(data.duration);
  const aspectRatio = normalizeAspect(data.aspectRatio);
  const resolution = normalizeResolution(data.resolution);
  const referenceMode = normalizeReferenceMode(data.referenceMode);
  const credit = Math.max(1, Math.round(duration * 10));
  const historyIds = data.generationHistoryIds ?? [];

  const onOptimizePrompt = () => {
    const base = flush().trim();
    if (!base) {
      setNotice("请先填写描述，再优化提示词");
      return;
    }
    const next = `${base}。画面清晰，运镜自然，主体明确。`;
    setValue(next);
    updateNodeData(nodeId, { generationInstruction: next });
    setNotice("已附加基础优化后缀（本地规则，非外部模型）");
  };

  const onSelectHistory = (assetId: string) => {
    updateNodeData(nodeId, {
      resultAssetId: assetId,
      status: "completed",
      progress: 100,
      errorMessage: "",
    });
    setNotice("已切换到历史视频生成");
  };

  const onGenerate = async () => {
    const trimmed = flush().trim();
    if (!trimmed) {
      setNotice("请先描述要生成的短片内容");
      return;
    }

    setSubmitting(true);
    setNotice("");
    updateNodeData(nodeId, {
      status: "processing",
      progress: 10,
      errorMessage: "",
      duration,
      aspectRatio,
      resolution,
      referenceMode,
      creditEstimate: credit,
    });

    try {
      const result = await requestVideoShotGeneration({
        projectId,
        videoShotNodeId: nodeId,
        title: data.title,
        prompt: trimmed,
        model: data.model,
        aspectRatio,
        duration,
        resolution,
        stylePreset: data.stylePreset,
        referenceMode,
        cameraMovement: data.cameraMovement,
      });
      commitNodeAssets(nodeId, [result.asset], {
        status: "completed",
        progress: 100,
        resultAssetId: result.asset.id,
        creditEstimate: result.creditEstimate,
        errorMessage: "",
        generationHistoryIds: prependGenerationHistory(
          data.generationHistoryIds,
          result.asset.id,
        ),
      });
      setNotice(result.notice);
      setHistoryOpen(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "生成失败，请重试";
      updateNodeData(nodeId, {
        status: "failed",
        progress: 0,
        errorMessage: message,
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
          placeholder="描述你想要生成的短片内容，键入 @ 引用素材…"
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

      <div className="flex flex-wrap items-center gap-1.5">
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

        <DurationCombobox
          value={duration}
          disabled={busy}
          onChange={(next) =>
            updateNodeData(nodeId, {
              duration: next,
              creditEstimate: Math.max(1, Math.round(next * 10)),
            })
          }
        />

        <select
          className={glass.select}
          value={resolution}
          disabled={busy}
          onChange={(e) =>
            updateNodeData(nodeId, {
              resolution: normalizeResolution(e.target.value),
            })
          }
          title="画质"
        >
          {RESOLUTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          className={glass.select}
          value={referenceMode}
          disabled={busy}
          onChange={(e) =>
            updateNodeData(nodeId, {
              referenceMode: normalizeReferenceMode(e.target.value),
            })
          }
          title="参考"
        >
          {REFERENCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1.5">
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
          <span className={glass.credit}>{credit}</span>
          <GlassSendButton
            busy={busy}
            title={busy ? "生成中…" : "生成"}
            onClick={() => void onGenerate()}
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
          </GlassSendButton>
        </div>
      </div>

      <GenerationHistoryPopover
        open={historyOpen}
        historyIds={historyIds}
        activeAssetId={data.resultAssetId}
        onSelect={onSelectHistory}
      />

      {notice && (
        <div className="mt-2 px-0.5 text-[10px] leading-relaxed text-zinc-500">
          {notice}
        </div>
      )}
    </div>
  );
}
