"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { GlassSendButton, glass } from "@/workflow/components/glass-ui";
import {
  GenerationHistoryButton,
  GenerationHistoryPopover,
} from "@/workflow/components/GenerationHistoryPopover";
import { MentionTextarea } from "@/workflow/components/MentionTextarea";
import { PromptReferenceChips } from "@/workflow/components/PromptReferenceChips";
import { useDebouncedCommit } from "@/workflow/hooks/useDebouncedCommit";
import { prependGenerationHistory } from "@/workflow/lib/generation-history";
import { requestSceneImage } from "@/workflow/lib/request-scene-generation";
import { useWorkflowStore } from "@/workflow/store";
import type { SceneNodeData } from "@/workflow/types";

type Props = {
  nodeId: string;
};

export function ScenePromptPanel({ nodeId }: Props) {
  const projectId = useWorkflowStore((s) => s.projectId);
  const node = useWorkflowStore((s) =>
    s.document.nodes.find((n) => n.id === nodeId),
  );
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const commitNodeAssets = useWorkflowStore((s) => s.commitNodeAssets);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const data = node?.type === "scene" ? (node.data as SceneNodeData) : null;
  const storePrompt = data?.generationPrompt ?? "";

  const { draft, setValue, flush } = useDebouncedCommit(storePrompt, (value) => {
    updateNodeData(nodeId, {
      generationPrompt: value,
      description: value,
    });
  });

  if (!data) return null;

  const busy = submitting || data.generationStatus === "processing";
  const historyIds = data.generationHistoryIds ?? [];

  const onSelectHistory = (assetId: string) => {
    updateNodeData(nodeId, {
      primaryAssetId: assetId,
      referenceAssetIds: [...new Set([...data.referenceAssetIds, assetId])],
      generationStatus: "completed",
      uploadStatus: "ready",
      errorMessage: "",
    });
    setNotice("已切换到历史场景生成");
  };

  const onGenerate = async () => {
    const trimmed = flush().trim();
    if (!trimmed) {
      setNotice("请先描述要生成的场景画面");
      return;
    }

    setSubmitting(true);
    setNotice("");
    updateNodeData(nodeId, {
      errorMessage: "",
      generationStatus: "processing",
    });

    try {
      const result = await requestSceneImage({
        projectId,
        sceneNodeId: nodeId,
        sceneName: data.sceneName || data.title,
        prompt: trimmed,
      });
      const viewpoint = {
        id: `vp-${crypto.randomUUID().slice(0, 8)}`,
        tag: "custom" as const,
        label: "AI 生成",
        assetId: result.asset.id,
      };
      commitNodeAssets(nodeId, [result.asset], {
        generationStatus: "completed",
        uploadStatus: "ready",
        errorMessage: "",
        primaryAssetId: result.asset.id,
        viewpoints: [...data.viewpoints, viewpoint],
        referenceAssetIds: [
          ...new Set([...data.referenceAssetIds, result.asset.id]),
        ],
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
        generationStatus: "failed",
        errorMessage: message,
      });
      setNotice(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={`nodrag nopan nowheel w-[360px] ${glass.panel}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <PromptReferenceChips nodeId={nodeId} />
      <div className="mb-2.5">
        <MentionTextarea
          placeholder="描述你想要生成的场景画面，键入 @ 引用素材…"
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
      </div>

      <div className="flex items-center gap-2">
        <span className={`${glass.status} text-zinc-600`}>场景画面生成</span>
        <div className="ml-auto flex items-center gap-1.5">
          <GenerationHistoryButton
            open={historyOpen}
            historyIds={historyIds}
            disabled={busy}
            onToggle={() => setHistoryOpen((v) => !v)}
          />
          <GlassSendButton
            busy={busy}
            title={busy ? "生成中…" : "生成场景图"}
            onClick={() => void onGenerate()}
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
          </GlassSendButton>
        </div>
      </div>

      <GenerationHistoryPopover
        open={historyOpen}
        historyIds={historyIds}
        activeAssetId={data.primaryAssetId}
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
