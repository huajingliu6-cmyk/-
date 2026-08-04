"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Wand2 } from "lucide-react";
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
import { FrameSlotButton } from "@/workflow/components/FrameSlotButton";
import { GenerationConfirmationDrawer } from "@/workflow/components/GenerationConfirmationDrawer";
import { ReferenceMediaSelectionDrawer } from "@/workflow/components/ReferenceMediaSelectionDrawer";
import { useDebouncedCommit } from "@/workflow/hooks/useDebouncedCommit";
import { prependGenerationHistory } from "@/workflow/lib/generation-history";
import { prepareReferenceMediaSelectionBundle } from "@/workflow/lib/prepare-reference-media-selection";
import { useWorkflowStore } from "@/workflow/store";
import { GlassSelect } from "@/shell/glass-select";
import type { VideoShotNodeData } from "@/workflow/types";
import type {
  GenerationRecord,
  ModelCapability,
  ProviderCapabilities,
  VideoAspectRatio,
  VideoProviderId,
  VideoResolution,
} from "@/video-generation/types";
import {
  isVideoAspectRatio,
  isVideoResolution,
} from "@/video-generation/dimensions";
import { getDurationCompatibilityWarning } from "@/video-generation/validate-settings";
import { selectWanGenerationMode } from "@/video-generation/select-wan-mode";
import { buildVideoGenerationInput } from "@/workflow/lib/build-video-generation-input";
import {
  buildGenerationParameterComparisonView,
  formatParameterComparisonHistoryLabel,
} from "@/video-generation/parameter-comparison-view";

type PublicConfig = {
  providerId: VideoProviderId;
  allowPaidGeneration: boolean;
  hasApiKey: boolean;
  hasWorkspaceId: boolean;
  hasEndpoint?: boolean;
  region: string;
  t2vModelId: string;
  r2vModelId: string;
  recommendedPollIntervalMs?: number;
  costNotice?: string;
};

type Props = {
  nodeId: string;
  onOpenVideoResult?: (generation: GenerationRecord | null) => void;
  /** 轮询得到的 GenerationRecord 快照，供节点摘要展示（不发起额外请求） */
  onGenerationSnapshot?: (generation: GenerationRecord | null) => void;
  /** 紧凑参考素材摘要（供节点卡片展示，不发网络） */
  onReferenceSummary?: (label: string) => void;
};

export function VideoPromptPanel({
  nodeId,
  onOpenVideoResult,
  onGenerationSnapshot,
  onReferenceSummary,
}: Props) {
  const projectId = useWorkflowStore((s) => s.projectId);
  const node = useWorkflowStore((s) =>
    s.document.nodes.find((n) => n.id === nodeId),
  );
  /** 分字段订阅，避免视口平移导致面板重渲 */
  const edges = useWorkflowStore((s) => s.document.edges);
  const assets = useWorkflowStore((s) => s.document.assets);
  const nodes = useWorkflowStore((s) => s.document.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const commitNodeAssets = useWorkflowStore((s) => s.commitNodeAssets);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [capabilities, setCapabilities] = useState<ProviderCapabilities | null>(
    null,
  );
  const [generation, setGeneration] = useState<GenerationRecord | null>(null);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const manageRefBtn = useRef<HTMLButtonElement>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 同步防连点：React setState 异步，仅靠 submitting state 挡不住双击 */
  const submittingRef = useRef(false);
  /** 同一次确认会话复用；成功后清空，避免 Date.now() 破坏服务端幂等 */
  const idempotencyKeyRef = useRef<string | null>(null);
  // 节点切换时关闭选择面板，避免草稿落到其他节点
  if (selectionOpen && selectedNodeId !== nodeId) {
    setSelectionOpen(false);
  }

  const data =
    node?.type === "videoShot" ? (node.data as VideoShotNodeData) : null;
  const storePrompt = data?.generationInstruction ?? "";

  const { draft, setValue, flush } = useDebouncedCommit(storePrompt, (value) => {
    updateNodeData(nodeId, { generationInstruction: value });
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/generations");
        if (!res.ok) return;
        const payload = (await res.json()) as {
          config: PublicConfig;
          capabilities: ProviderCapabilities;
        };
        if (!cancelled) {
          setConfig(payload.config);
          setCapabilities(payload.capabilities);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config) return;
    // 仅在 provider 真正变化时写入，避免选中镜头就 dirty→保存→HMR 死循环
    if (data?.provider === config.providerId) return;
    updateNodeData(nodeId, { provider: config.providerId });
  }, [config, data?.provider, nodeId, updateNodeData]);

  const selectionCap = useMemo(() => {
    if (!capabilities) return null;
    return (
      capabilities.models.find((m) => m.mode === "referenceToVideo") ??
      capabilities.models[0] ??
      null
    );
  }, [capabilities]);

  const selectionBundle = useMemo(() => {
    if (!data) return null;
    const base = useWorkflowStore.getState().document;
    return prepareReferenceMediaSelectionBundle({
      document: { ...base, edges, assets, nodes },
      videoShotNodeId: nodeId,
      capability: selectionCap
        ? {
            maxReferenceMedia: selectionCap.maxReferenceMedia,
            maxFirstFrames: selectionCap.maxFirstFrames,
            supportsReferenceImages: selectionCap.supportsReferenceImages,
            supportsReferenceVideos: selectionCap.supportsReferenceVideos,
            supportsFirstFrame: selectionCap.supportsFirstFrame,
          }
        : null,
      mode:
        data.referenceSelectionMode === "manual" ? "manual" : "auto",
      selectedReferenceAssetIds: data.selectedReferenceAssetIds ?? [],
    });
  }, [data, nodeId, edges, assets, nodes, selectionCap]);

  const selectionView = selectionBundle?.view ?? null;

  useEffect(() => {
    onReferenceSummary?.(selectionView?.nodeSummaryLabel ?? "");
  }, [selectionView?.nodeSummaryLabel, onReferenceSummary]);

  const workflowDocument = useMemo(() => {
    const base = useWorkflowStore.getState().document;
    return { ...base, edges, assets, nodes };
  }, [edges, assets, nodes]);

  const builtPreview = useMemo(() => {
    if (!data) return null;
    const base = useWorkflowStore.getState().document;
    return buildVideoGenerationInput(
      { ...base, edges, assets, nodes },
      nodeId,
      {
        capability: selectionCap
          ? {
              maxReferenceMedia: selectionCap.maxReferenceMedia,
              maxFirstFrames: selectionCap.maxFirstFrames,
              supportsReferenceImages: selectionCap.supportsReferenceImages,
              supportsReferenceVideos: selectionCap.supportsReferenceVideos,
              supportsFirstFrame: selectionCap.supportsFirstFrame,
            }
          : undefined,
      },
    );
  }, [data, nodeId, edges, assets, nodes, selectionCap]);

  const mode = useMemo(() => {
    if (!builtPreview || !builtPreview.ok) return "textToVideo" as const;
    return selectWanGenerationMode(builtPreview.input);
  }, [builtPreview]);

  const capability: ModelCapability | null = useMemo(() => {
    if (!capabilities) return null;
    return capabilities.models.find((m) => m.mode === mode) ?? null;
  }, [capabilities, mode]);

  const durationWarning = useMemo(() => {
    if (!data || !capability) return null;
    const hasRefVideo =
      Boolean(data.sourceVideoAssetId) ||
      (builtPreview?.ok && builtPreview.input.referenceVideos.length > 0);
    return getDurationCompatibilityWarning(
      data.duration,
      Boolean(hasRefVideo),
      capability.maxDurationWithReferenceVideoSeconds,
    );
  }, [data, capability, builtPreview]);

  useEffect(() => {
    const activeId = data?.activeGenerationId;
    if (!activeId) return;
    let cancelled = false;
    let inFlight = false;
    const pollMs = config?.recommendedPollIntervalMs ?? 3_500;

    const stop = () => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };

    const schedule = () => {
      if (cancelled || pollRef.current) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      pollRef.current = setTimeout(() => {
        pollRef.current = null;
        void tick();
      }, pollMs);
    };

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      inFlight = true;
      try {
        const res = await fetch(`/api/generations/${activeId}`);
        const payload = (await res.json()) as {
          generation?: GenerationRecord;
          asset?: { id: string } | null;
          comparison?: Array<{ message: string }>;
        };
        if (!payload.generation) return;
        const g = payload.generation;
        setGeneration(g);
        onGenerationSnapshot?.(g);

        const current = useWorkflowStore.getState().document.nodes.find(
          (n) => n.id === nodeId,
        )?.data as VideoShotNodeData | undefined;

        // 已有成片时忽略后续失败/重复轮询，避免把成功刷成「任务不存在」
        if (current?.resultAssetId && current.status === "completed") {
          stop();
          cancelled = true;
          return;
        }

        if (g.resultAsset && g.status === "completed") {
          commitNodeAssets(nodeId, [g.resultAsset], {
            status: "completed",
            progress: 100,
            resultAssetId: g.resultAsset.id,
            generationHistoryIds: prependGenerationHistory(
              current?.generationHistoryIds ?? [],
              g.resultAsset.id,
            ),
            activeGenerationId: g.id,
            errorMessage: "",
          });
          if (payload.comparison && payload.comparison.length > 0) {
            setNotice(payload.comparison.map((c) => c.message).join("；"));
          } else {
            setNotice(g.progressLabel);
          }
          stop();
          cancelled = true;
          return;
        }

        const nextStatus =
          g.status === "failed" ||
          g.status === "resultTransferFailed" ||
          g.status === "unknownOutcome"
            ? "failed"
            : g.status === "cancelled"
              ? "cancelled"
              : "processing";
        const nextError = g.errorMessage ?? "";

        if (
          !current ||
          current.status !== nextStatus ||
          current.errorMessage !== nextError
        ) {
          updateNodeData(nodeId, {
            status: nextStatus,
            progress: 0,
            errorMessage: nextError,
          });
        }

        if (
          g.status === "failed" ||
          g.status === "cancelled" ||
          g.status === "resultTransferFailed" ||
          g.status === "unknownOutcome"
        ) {
          setNotice(
            g.status === "unknownOutcome"
              ? g.errorMessage ||
                  "提交结果暂时无法确认，为避免重复计费，系统已暂停自动重试。"
              : g.errorMessage || g.progressLabel,
          );
          stop();
          cancelled = true;
        }
      } catch {
        // ignore transient
      } finally {
        inFlight = false;
        if (!cancelled) schedule();
      }
    };

    void tick();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        stop();
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    data?.activeGenerationId,
    nodeId,
    updateNodeData,
    commitNodeAssets,
    onGenerationSnapshot,
    config?.recommendedPollIntervalMs,
  ]);

  const comparisonLabelByAssetId = useMemo(() => {
    const map: Record<string, string> = {};
    if (generation?.resultAsset?.id) {
      const view = buildGenerationParameterComparisonView(generation);
      map[generation.resultAsset.id] =
        formatParameterComparisonHistoryLabel(view);
    } else if (generation?.localVideoAssetId) {
      const view = buildGenerationParameterComparisonView(generation);
      map[generation.localVideoAssetId] =
        formatParameterComparisonHistoryLabel(view);
    }
    return map;
  }, [generation]);

  if (!data) return null;

  const busy =
    submitting ||
    data.status === "processing" ||
    data.status === "queued" ||
    Boolean(data.activeGenerationId && generation && !["completed", "failed", "cancelled", "resultTransferFailed"].includes(generation.status));

  const hasFirstFrame = Boolean(
    data.startFrameAssetId || selectionView?.firstFrame,
  );
  const firstFrameFromEdgeOnly = Boolean(
    selectionView?.firstFrame && !data.startFrameAssetId,
  );
  const resolution: VideoResolution = isVideoResolution(data.resolution)
    ? data.resolution
    : "720P";
  const aspectRatio: VideoAspectRatio = isVideoAspectRatio(data.aspectRatio)
    ? data.aspectRatio
    : "9:16";
  const duration = clampVideoDuration(
    data.duration,
    capability?.minDurationSeconds ?? 2,
    capability
      ? builtPreview?.ok && builtPreview.input.referenceVideos.length > 0
        ? capability.maxDurationWithReferenceVideoSeconds
        : capability.maxDurationSeconds
      : 15,
  );

  const mediaLimit = selectionView?.limit ?? capability?.maxReferenceMedia ?? null;
  const capabilityReady = Boolean(capability) && Boolean(selectionView?.capabilityLoaded);
  const mediaCount = selectionView?.eligibleCount ?? 0;
  const requiresManualSelection = Boolean(
    selectionView?.requiresManualSelection,
  );
  const canOpenConfirm =
    Boolean(selectionView?.canGenerate) &&
    Boolean(builtPreview?.ok) &&
    capabilityReady;

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
    if (
      generation?.resultAsset?.id === assetId ||
      generation?.localVideoAssetId === assetId
    ) {
      onOpenVideoResult?.(generation);
    } else {
      onOpenVideoResult?.(null);
    }
  };

  const onConfirmGenerate = async (confirmPaid: boolean) => {
    if (submittingRef.current) return;
    const trimmed = flush().trim();
    if (!trimmed) {
      setNotice("请先描述要生成的短片内容");
      return;
    }
    if (!capability) {
      setNotice("模型能力尚未加载");
      return;
    }
    if (durationWarning) {
      setNotice(durationWarning);
      return;
    }
    if (requiresManualSelection || (builtPreview && !builtPreview.ok && builtPreview.requiresManualSelection)) {
      const msg =
        builtPreview && !builtPreview.ok
          ? builtPreview.errors[0]
          : `当前有 ${mediaCount} 项参考素材，当前模型最多支持 ${capability.maxReferenceMedia} 项，请先手动选择要发送的素材。`;
      setNotice(msg ?? "请先手动选择要发送的参考素材");
      return;
    }
    if (builtPreview && !builtPreview.ok) {
      setNotice(builtPreview.errors[0] ?? "生成输入无效");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setNotice("");
    setConfirmOpen(false);
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `${nodeId}-${crypto.randomUUID()}`
          : `${nodeId}-${Date.now()}`;
    }
    const idempotencyKey = idempotencyKeyRef.current;
    updateNodeData(nodeId, {
      status: "processing",
      progress: 0,
      errorMessage: "",
      duration,
      aspectRatio: hasFirstFrame ? data.aspectRatio : aspectRatio,
      resolution,
    });

    try {
      const res = await fetch("/api/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          videoShotNodeId: nodeId,
          confirmPaidGeneration: confirmPaid,
          idempotencyKey,
          selectedReferenceAssetIds: data.selectedReferenceAssetIds,
          title: data.title,
        }),
      });
      const payload = (await res.json()) as {
        generation?: GenerationRecord;
        message?: string;
        code?: string;
      };
      if (!res.ok || !payload.generation) {
        // 未知结果：保留键并阻断同一请求自动重试
        if (payload.code === "GENERATION_SUBMISSION_UNKNOWN") {
          throw new Error(
            payload.message ??
              "提交结果暂时无法确认，为避免重复计费，系统已暂停自动重试。",
          );
        }
        // 服务端已给出明确业务结果 → 释放键，允许用户重新开确认会话再试
        if (
          payload.generation ||
          (payload.code &&
            payload.code !== "IDEMPOTENCY_IN_PROGRESS" &&
            payload.code !== "ACTIVE_GENERATION_ALREADY_EXISTS")
        ) {
          idempotencyKeyRef.current = null;
        }
        throw new Error(payload.message ?? "提交失败");
      }
      if (
        payload.generation.status === "failed" ||
        payload.generation.status === "cancelled"
      ) {
        // 幂等命中返回终态失败时，不得当作 processing；释放键供明确重试
        idempotencyKeyRef.current = null;
        throw new Error(
          payload.generation.errorMessage ??
            payload.message ??
            "提交失败",
        );
      }
      if (payload.generation.status === "unknownOutcome") {
        // 不释放键；禁止同一请求一键再次付费提交
        throw new Error(
          payload.generation.errorMessage ??
            "提交结果暂时无法确认，为避免重复计费，系统已暂停自动重试。",
        );
      }
      // 成功受理（queued 等）后清空；同会话连点已用同一键命中服务端幂等
      idempotencyKeyRef.current = null;
      setGeneration(payload.generation);
      updateNodeData(nodeId, {
        activeGenerationId: payload.generation.id,
        model: payload.generation.providerModelId,
        provider: payload.generation.providerId,
        status: "processing",
      });
      setNotice(payload.generation.progressLabel);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "生成失败，请重试";
      updateNodeData(nodeId, {
        status: "failed",
        progress: 0,
        errorMessage: message,
        activeGenerationId: "",
      });
      setNotice(message);
      // 网络/解析异常且未拿到业务码：保留键，短时内重试可命中幂等
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const onCancel = async () => {
    if (!data.activeGenerationId) return;
    const res = await fetch(
      `/api/generations/${data.activeGenerationId}/cancel`,
      { method: "POST" },
    );
    const payload = (await res.json()) as {
      generation?: GenerationRecord;
      message?: string;
    };
    if (!res.ok) {
      setNotice(payload.message ?? "取消失败");
      return;
    }
    setGeneration(payload.generation ?? null);
    updateNodeData(nodeId, {
      status: "cancelled",
      activeGenerationId: "",
    });
    setNotice("已取消");
  };

  const onRetry = async () => {
    // 明确重新生成：新确认会话、新幂等键（不复用旧任务键）；可能产生新费用
    const wasUnknown =
      generation?.status === "unknownOutcome" ||
      notice.includes("暂时无法确认");
    idempotencyKeyRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `${nodeId}-${crypto.randomUUID()}`
        : `${nodeId}-${Date.now()}`;
    if (wasUnknown) {
      setNotice(
        "重新生成将使用新的幂等键，可能产生重复计费。请确认后再提交。",
      );
    }
    setConfirmOpen(true);
  };

  const resolutionOptions = capability?.supportedResolutions ?? [
    "480P",
    "720P",
    "1080P",
  ];
  const aspectOptions = capability?.supportedAspectRatios ?? [
    "16:9",
    "9:16",
    "1:1",
    "4:3",
    "3:4",
  ];
  const minDur = capability?.minDurationSeconds ?? 2;
  const maxDur = capability
    ? builtPreview?.ok && builtPreview.input.referenceVideos.length > 0
      ? capability.maxDurationWithReferenceVideoSeconds
      : capability.maxDurationSeconds
    : 15;

  return (
    <div
      className={`nodrag nopan nowheel w-[min(520px,92vw)] ${glass.panel}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
        <span className="rounded-md bg-zinc-100 px-1.5 py-0.5">
          {selectionView?.nodeSummaryLabel ?? "参考素材"}
        </span>
        <button
          ref={manageRefBtn}
          type="button"
          className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
          onClick={() => setSelectionOpen(true)}
        >
          管理参考素材
        </button>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5 text-[10px] text-zinc-500">
        <span className="rounded-md bg-zinc-100 px-1.5 py-0.5">
          Provider：{config?.providerId ?? data.provider}
        </span>
        <span className="rounded-md bg-zinc-100 px-1.5 py-0.5">
          模型：{capability?.modelId ?? data.model}
        </span>
        <span className="rounded-md bg-zinc-100 px-1.5 py-0.5">
          模式：{mode === "textToVideo" ? "文生视频" : "参考生视频"}
        </span>
        <span className="rounded-md bg-zinc-100 px-1.5 py-0.5">
          素材：{mediaCount}
          {mediaLimit != null ? ` / ${mediaLimit}` : ""}
        </span>
        {!capabilityReady ? (
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-800">
            模型能力尚未加载
          </span>
        ) : null}
        {requiresManualSelection ? (
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-800">
            需手动选择参考素材
          </span>
        ) : null}
        {selectionView?.hasInvalidSelection ? (
          <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-rose-800">
            选择存在失效项
          </span>
        ) : null}
        {generation && (
          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-800">
            {generation.progressLabel}
          </span>
        )}
      </div>

      <PromptReferenceChips nodeId={nodeId} />
      <div className="relative mb-2.5">
        <MentionTextarea
          className="pr-8"
          placeholder="描述你想要生成的短片内容，键入 @ 引用素材…"
          value={draft}
          disabled={busy}
          onChange={setValue}
          onBlur={() => flush()}
          onMentionPick={(asset, nextValue) => {
            // 立刻写回，避免防抖期间候选收集读不到 @token
            updateNodeData(nodeId, { generationInstruction: nextValue });
            if (!data || asset.assetType === "audio") return;
            if (data.referenceSelectionMode !== "manual") return;
            const ids = data.selectedReferenceAssetIds ?? [];
            if (ids.includes(asset.id)) return;
            updateNodeData(nodeId, {
              selectedReferenceAssetIds: [...ids, asset.id],
            });
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <FrameSlotButton
          label="首帧"
          assetId={data.startFrameAssetId}
          projectId={projectId}
          disabled={busy}
          previewUrl={selectionView?.firstFrame?.thumbnailUrl || selectionView?.firstFrame?.url}
          previewLocked={firstFrameFromEdgeOnly}
          title={
            firstFrameFromEdgeOnly
              ? "已通过连线设置首帧（在图片节点上管理）"
              : "上传首帧图片"
          }
          onChange={(assetId, uploaded) => {
            const endId = data.endFrameAssetId;
            const patch = {
              startFrameAssetId: assetId,
              continuityMode:
                assetId && endId
                  ? ("startAndEndFrame" as const)
                  : assetId
                    ? ("startFrame" as const)
                    : ("standalone" as const),
            };
            if (uploaded) {
              commitNodeAssets(nodeId, [uploaded], patch);
            } else {
              updateNodeData(nodeId, patch);
            }
          }}
          onUploadError={(message) => setNotice(message)}
        />
        <FrameSlotButton
          label="尾帧"
          assetId={data.endFrameAssetId}
          projectId={projectId}
          disabled={busy}
          title="上传尾帧图片"
          onChange={(assetId, uploaded) => {
            const startId = data.startFrameAssetId;
            const patch = {
              endFrameAssetId: assetId,
              continuityMode:
                startId && assetId
                  ? ("startAndEndFrame" as const)
                  : startId
                    ? ("startFrame" as const)
                    : ("standalone" as const),
            };
            if (uploaded) {
              commitNodeAssets(nodeId, [uploaded], patch);
            } else {
              updateNodeData(nodeId, patch);
            }
          }}
          onUploadError={(message) => setNotice(message)}
        />

        <GlassSelect
          variant="toolbar"
          label="画面比例"
          title={
            hasFirstFrame
              ? "已设置首帧，视频比例将根据首帧图片自动确定"
              : "画面比例"
          }
          value={hasFirstFrame ? "" : aspectRatio}
          disabled={busy || hasFirstFrame}
          options={
            hasFirstFrame
              ? [{ id: "", label: "由首帧决定" }]
              : aspectOptions.map((opt) => ({ id: opt, label: opt }))
          }
          onChange={(id) => {
            if (isVideoAspectRatio(id)) {
              updateNodeData(nodeId, { aspectRatio: id });
            }
          }}
        />

        <DurationCombobox
          value={data.duration}
          min={minDur}
          max={maxDur}
          disabled={busy}
          onChange={(next) =>
            updateNodeData(nodeId, {
              duration: next,
              creditEstimate: Math.max(1, Math.round(next * 10)),
            })
          }
        />

        <GlassSelect
          variant="toolbar"
          label="画质"
          title="画质"
          value={resolution}
          disabled={busy}
          options={resolutionOptions.map((opt) => ({
            id: opt,
            label: opt,
          }))}
          onChange={(id) => {
            if (isVideoResolution(id)) {
              updateNodeData(nodeId, { resolution: id });
            }
          }}
        />

        <div className="ml-auto flex items-center gap-1.5">
          <GenerationHistoryButton
            open={historyOpen}
            historyIds={data.generationHistoryIds ?? []}
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
          {busy && data.activeGenerationId ? (
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-2 py-1 text-[11px] text-zinc-600"
              onClick={() => void onCancel()}
            >
              取消
            </button>
          ) : null}
          {!busy && data.status === "failed" ? (
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-2 py-1 text-[11px] text-zinc-600"
              onClick={() => void onRetry()}
            >
              重试
            </button>
          ) : null}
          <GlassSendButton
            busy={busy}
            disabled={busy || !canOpenConfirm}
            title={
              !capabilityReady
                ? "模型能力尚未加载"
                : requiresManualSelection
                  ? "请先手动选择参考素材"
                  : busy
                    ? "生成中…"
                    : "打开生成确认"
            }
            onClick={() => {
              if (!canOpenConfirm) {
                if (!capabilityReady) {
                  setNotice("模型能力尚未加载");
                  return;
                }
                if (requiresManualSelection) {
                  setNotice(
                    builtPreview && !builtPreview.ok
                      ? (builtPreview.errors[0] ??
                          "请先手动选择要发送的参考素材")
                      : "请先手动选择要发送的参考素材",
                  );
                  return;
                }
                if (builtPreview && !builtPreview.ok) {
                  setNotice(builtPreview.errors[0] ?? "生成输入无效");
                  return;
                }
                return;
              }
              if (!idempotencyKeyRef.current) {
                idempotencyKeyRef.current =
                  typeof crypto !== "undefined" && "randomUUID" in crypto
                    ? `${nodeId}-${crypto.randomUUID()}`
                    : `${nodeId}-${Date.now()}`;
              }
              setConfirmOpen(true);
            }}
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
          </GlassSendButton>
        </div>
      </div>

      {hasFirstFrame && (
        <div className="mt-1.5 text-[10px] text-amber-700">
          已设置首帧，视频比例将根据首帧图片自动确定；首帧不占普通参考素材名额
        </div>
      )}
      {selectionView && selectionView.blockingErrors.length > 0 ? (
        <div className="mt-1.5 text-[10px] text-rose-600">
          {selectionView.blockingErrors[0]}
        </div>
      ) : null}
      {durationWarning && (
        <div className="mt-1.5 text-[10px] text-rose-600">
          {durationWarning}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() =>
              updateNodeData(nodeId, {
                duration:
                  capability?.maxDurationWithReferenceVideoSeconds ?? 10,
              })
            }
          >
            确认改为最大允许时长
          </button>
        </div>
      )}

      <GenerationHistoryPopover
        open={historyOpen}
        historyIds={data.generationHistoryIds ?? []}
        activeAssetId={data.resultAssetId}
        onSelect={onSelectHistory}
        comparisonLabelByAssetId={comparisonLabelByAssetId}
      />

      {notice && (
        <div className="mt-2 px-0.5 text-[10px] leading-relaxed text-zinc-500">
          {notice}
        </div>
      )}

      <GenerationConfirmationDrawer
        open={confirmOpen}
        onClose={() => {
          if (!submittingRef.current) {
            // 未提交关闭：丢弃本会话 key，下次打开重新生成
            idempotencyKeyRef.current = null;
          }
          setConfirmOpen(false);
        }}
        config={config}
        capability={capability}
        mode={mode}
        resolution={resolution}
        aspectRatio={hasFirstFrame ? null : aspectRatio}
        durationSeconds={data.duration}
        built={builtPreview}
        selectionView={selectionView}
        submitting={submitting}
        onManageReferences={() => {
          setConfirmOpen(false);
          setSelectionOpen(true);
        }}
        onConfirmMock={() => void onConfirmGenerate(false)}
        onConfirmPaid={() => void onConfirmGenerate(true)}
      />

      <ReferenceMediaSelectionDrawer
        open={selectionOpen}
        videoShotNodeId={nodeId}
        document={workflowDocument}
        capability={selectionCap}
        providerId={config?.providerId ?? data.provider}
        onClose={() => setSelectionOpen(false)}
        onRequestFocusReturn={() => manageRefBtn.current?.focus()}
        onJumpToNode={(id) => {
          useWorkflowStore.getState().setSelectedNodeId(id);
          setSelectionOpen(false);
        }}
      />
    </div>
  );
}
