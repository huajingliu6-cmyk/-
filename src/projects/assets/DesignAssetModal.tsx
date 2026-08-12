"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Download, History, ShieldCheck } from "lucide-react";
import type {
  AssetDesignPromptHistoryEntry,
  EpisodeAssetDesignItem,
  GeneratedMediaState,
} from "@/projects/assets/episode-design/types";
import type { VideoRefSafety } from "@/projects/assets/types";
import { formatDesignDraftSeedText } from "@/projects/assets/episode-design/format-design-draft-seed";
import {
  designVideoRefSafetyBadge,
  isDesignMediaVideoRefLocked,
} from "@/projects/assets/episode-design/design-media-video-ref-labels";
import { withDesignCurrentMediaAndVoiceMirror } from "@/projects/assets/episode-design/design-media-voice";
import {
  appendPromptHistory,
  mergeMediaIdLists,
} from "@/projects/assets/episode-design/generated-media-history";
import { getProjectAssetImageUrl } from "@/projects/assets/asset-image-url";
import { DesignImageLightbox } from "@/projects/assets/DesignImageLightbox";
import { useGenerationBusy } from "@/shell/GenerationBusyGuard";
import { safeRandomUUID } from "@/lib/safe-random-id";
import type { AssetGenerationProgress } from "@/projects/assets/DesignGenerationOverlay";
import {
  DEFAULT_DESIGN_IMAGE_OPTIONS,
  DESIGN_IMAGE_ASPECT_RATIOS,
  DESIGN_IMAGE_ASPECT_RATIO_LABELS,
  DESIGN_IMAGE_COUNTS,
  DESIGN_IMAGE_QUALITIES,
  DESIGN_IMAGE_QUALITY_LABELS,
  formatDesignImagePreviewTitle,
  type DesignImageGenerationOptions,
} from "@/projects/assets/episode-design/image-generation-options";
import {
  DEFAULT_DESIGN_PROMPT_MODEL_ID,
  DESIGN_PROMPT_MODELS,
  type DesignPromptModelId,
} from "@/projects/assets/episode-design/design-prompt-models";
import {
  GlassSelect,
  type GlassSelectOption,
} from "@/shell/glass-select";

const DESIGN_IMAGE_QUALITY_OPTIONS: GlassSelectOption[] =
  DESIGN_IMAGE_QUALITIES.map((value) => ({
    id: value,
    label: DESIGN_IMAGE_QUALITY_LABELS[value],
  }));

const DESIGN_IMAGE_RATIO_OPTIONS: GlassSelectOption[] =
  DESIGN_IMAGE_ASPECT_RATIOS.map((value) => ({
    id: value,
    label: DESIGN_IMAGE_ASPECT_RATIO_LABELS[value],
  }));

const DESIGN_IMAGE_COUNT_OPTIONS: GlassSelectOption[] =
  DESIGN_IMAGE_COUNTS.map((value) => ({
    id: String(value),
    label: `${value}张`,
  }));

const DESIGN_PROMPT_MODEL_OPTIONS: GlassSelectOption[] =
  DESIGN_PROMPT_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
  }));

export type DesignAssetModalProps = {
  open: boolean;
  item: EpisodeAssetDesignItem | null;
  projectId: string;
  episodeId: string;
  /** management | workspace — selects API base path */
  surface: "project_management" | "workspace";
  /** Parent-owned in-flight flag so remount / other actions keep「生成中」. */
  isGeneratingAsset?: boolean;
  onGeneratingAssetChange?: (itemId: string, generating: boolean) => void;
  onClose: () => void;
  onPromptUpdated: (
    itemId: string,
    promptText: string,
    meta?: {
      history?: AssetDesignPromptHistoryEntry[];
      generationId?: string | null;
    },
  ) => void;
  onAssetGenerated: (
    itemId: string,
    media?: GeneratedMediaState | null,
  ) => void;
  /** Persist media current selection patches from the modal (per history image). */
  onItemPatched?: (itemId: string, next: EpisodeAssetDesignItem) => void;
  /** Temporary UI progress for card overlay; null clears it. */
  onGenerationProgress?: (
    itemId: string,
    progress: AssetGenerationProgress | null,
  ) => void;
};

function apiBase(
  surface: DesignAssetModalProps["surface"],
  projectId: string,
  episodeId: string,
  itemId: string,
): { prompt: string; generate: string; videoRefPrecheck: string } {
  const enc = encodeURIComponent;
  if (surface === "workspace") {
    const root = `/api/workspace/projects/${enc(projectId)}/asset-designs/episodes/${enc(episodeId)}/items/${enc(itemId)}`;
    return {
      prompt: `${root}/generate-prompt`,
      generate: `${root}/generate-asset`,
      videoRefPrecheck: `${root}/video-ref-precheck`,
    };
  }
  const root = `/api/projects/${enc(projectId)}/asset-designs/episodes/${enc(episodeId)}/items/${enc(itemId)}`;
  return {
    prompt: `${root}/generate-prompt`,
    generate: `${root}/generate-asset`,
    videoRefPrecheck: `${root}/video-ref-precheck`,
  };
}

function initialPromptForItem(item: EpisodeAssetDesignItem): string {
  const saved = item.designPrompt?.text?.trim() ?? "";
  if (saved) return item.designPrompt!.text;
  return formatDesignDraftSeedText(item);
}

function pushLocalPromptHistory(
  prev: AssetDesignPromptHistoryEntry[] | undefined,
  entry: AssetDesignPromptHistoryEntry,
): AssetDesignPromptHistoryEntry[] {
  return appendPromptHistory(prev, entry);
}

function buildInitialPromptHistory(
  item: EpisodeAssetDesignItem,
  seed: string,
): AssetDesignPromptHistoryEntry[] {
  let history = item.designPrompt?.history ?? [];
  if (seed.trim() && !(item.designPrompt?.text?.trim())) {
    history = pushLocalPromptHistory(history, {
      text: seed,
      generatedAt: new Date().toISOString(),
      generationId: null,
      source: "extract",
    });
  }
  return history;
}

type DesignAssetModalBodyProps = DesignAssetModalProps & {
  item: EpisodeAssetDesignItem;
};

function DesignAssetModalBody({
  item,
  projectId,
  episodeId,
  surface,
  isGeneratingAsset = false,
  onGeneratingAssetChange,
  onClose,
  onPromptUpdated,
  onAssetGenerated,
  onItemPatched,
  onGenerationProgress,
}: DesignAssetModalBodyProps) {
  const titleId = useId();
  const seed = initialPromptForItem(item);
  const initialHistory = buildInitialPromptHistory(item, seed);
  const didSeedExtract =
    Boolean(seed.trim()) && !(item.designPrompt?.text?.trim());

  const [promptText, setPromptText] = useState(seed);
  const [promptModelId, setPromptModelId] = useState<DesignPromptModelId>(
    DEFAULT_DESIGN_PROMPT_MODEL_ID,
  );
  const [promptHistory, setPromptHistory] =
    useState<AssetDesignPromptHistoryEntry[]>(initialHistory);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [requirementOpen, setRequirementOpen] = useState(false);
  const [requirementDraft, setRequirementDraft] = useState("");
  const [requirementError, setRequirementError] = useState("");
  const requirementFieldId = useId();
  const [generatingAsset, setGeneratingAsset] = useState(false);
  const generateBusy = generatingAsset || isGeneratingAsset;
  useGenerationBusy(
    generateBusy || loadingPrompt,
    `design-modal-${item.id}`,
    loadingPrompt ? "资产提示词生成" : "资产图生成",
  );
  const [copyNote, setCopyNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [imageOptions, setImageOptions] = useState<DesignImageGenerationOptions>(
    DEFAULT_DESIGN_IMAGE_OPTIONS,
  );
  const [precheckBusy, setPrecheckBusy] = useState(false);
  const [videoRefSafety, setVideoRefSafety] = useState<VideoRefSafety | null>(
    item.generatedMedia?.videoRefSafety ?? null,
  );
  const [staleHint, setStaleHint] = useState(
    item.designPrompt?.status === "stale",
  );
  const [showPromptHistory, setShowPromptHistory] = useState(false);
  const [showImageHistory, setShowImageHistory] = useState(false);
  const [pickedMediaId, setPickedMediaId] = useState<string | null>(null);
  const [localHistoryIds, setLocalHistoryIds] = useState<string[]>(
    item.generatedMedia?.historyIds ?? [],
  );
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const previewObjectUrlRef = useRef<string | null>(null);
  const progressClearTimerRef = useRef<number | null>(null);
  const onPromptUpdatedRef = useRef(onPromptUpdated);
  const [syncedMediaCurrentId, setSyncedMediaCurrentId] = useState(
    item.generatedMedia?.currentId ?? null,
  );
  const [syncedPromptHistoryLen, setSyncedPromptHistoryLen] = useState(
    item.designPrompt?.history?.length ?? 0,
  );

  useEffect(() => {
    onPromptUpdatedRef.current = onPromptUpdated;
  }, [onPromptUpdated]);

  useEffect(() => {
    return () => {
      if (progressClearTimerRef.current != null) {
        window.clearTimeout(progressClearTimerRef.current);
        progressClearTimerRef.current = null;
      }
    };
  }, []);

  const reportProgress = useCallback(
    (progress: AssetGenerationProgress | null) => {
      onGenerationProgress?.(item.id, progress);
    },
    [item.id, onGenerationProgress],
  );

  const scheduleProgressClear = useCallback(
    (delayMs: number) => {
      if (progressClearTimerRef.current != null) {
        window.clearTimeout(progressClearTimerRef.current);
      }
      progressClearTimerRef.current = window.setTimeout(() => {
        progressClearTimerRef.current = null;
        onGenerationProgress?.(item.id, null);
      }, delayMs);
    },
    [item.id, onGenerationProgress],
  );

  useEffect(() => {
    if (!didSeedExtract) return;
    // Body remounts via key={item.id}; notify parent once after open seed.
    onPromptUpdatedRef.current(item.id, seed, { history: initialHistory });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once seed notify
  }, []);

  const incomingMedia = item.generatedMedia;
  const incomingCurrentId = incomingMedia?.currentId ?? null;
  if (incomingCurrentId !== syncedMediaCurrentId) {
    setSyncedMediaCurrentId(incomingCurrentId);
    if (incomingCurrentId) {
      setPickedMediaId(null);
    }
    setLocalHistoryIds((prev) =>
      mergeMediaIdLists(
        prev,
        incomingMedia?.historyIds ?? [],
        incomingCurrentId ? [incomingCurrentId] : [],
      ),
    );
  }

  const incomingPromptHistory = item.designPrompt?.history;
  const incomingPromptHistoryLen = incomingPromptHistory?.length ?? 0;
  if (
    incomingPromptHistory &&
    incomingPromptHistoryLen !== syncedPromptHistoryLen &&
    incomingPromptHistoryLen >= promptHistory.length
  ) {
    setSyncedPromptHistoryLen(incomingPromptHistoryLen);
    setPromptHistory(incomingPromptHistory);
  }

  const currentMediaId = pickedMediaId ?? incomingCurrentId;
  const imageHistoryIds = mergeMediaIdLists(
    localHistoryIds,
    incomingMedia?.historyIds ?? [],
    incomingCurrentId ? [incomingCurrentId] : [],
  );

  if (!currentMediaId && previewObjectUrl !== null) {
    setPreviewObjectUrl(null);
  }

  useEffect(() => {
    if (!currentMediaId || !projectId) {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    const run = async () => {
      setPreviewLoading(true);
      try {
        const url = getProjectAssetImageUrl(projectId, currentMediaId, {
          revision: `${currentMediaId}-${Date.now()}`,
        });
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            payload?.error ?? `预览加载失败（${res.status}）`,
          );
        }
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) {
          throw new Error("预览接口未返回图片数据");
        }
        const blob = await res.blob();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        createdUrl = objectUrl;
        if (previewObjectUrlRef.current) {
          URL.revokeObjectURL(previewObjectUrlRef.current);
        }
        previewObjectUrlRef.current = objectUrl;
        setPreviewObjectUrl(objectUrl);
        setError((prev) =>
          prev.includes("预览") || prev.includes("图片") ? "" : prev,
        );
      } catch (e) {
        if (!cancelled) {
          if (previewObjectUrlRef.current) {
            URL.revokeObjectURL(previewObjectUrlRef.current);
            previewObjectUrlRef.current = null;
          }
          setPreviewObjectUrl(null);
          setError(e instanceof Error ? e.message : "预览加载失败");
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (createdUrl && previewObjectUrlRef.current === createdUrl) {
        URL.revokeObjectURL(createdUrl);
        previewObjectUrlRef.current = null;
      }
    };
  }, [currentMediaId, projectId]);

  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
    };
  }, []);

  const regeneratePrompt = useCallback(
    async (userRequirement: string) => {
      setLoadingPrompt(true);
      setError("");
      setCopyNote("");
      setRequirementError("");
      try {
        const urls = apiBase(surface, projectId, episodeId, item.id);
        const res = await fetch(urls.prompt, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: `prompt-${item.id}-${Date.now()}`,
            userRequirement,
            promptModelId,
          }),
        });
        const payload = (await res.json()) as {
          error?: string;
          prompt?: string;
          promptModelId?: string;
          displayModelName?: string;
          providerModelId?: string;
          designPrompt?: {
            text?: string;
            status?: string;
            history?: AssetDesignPromptHistoryEntry[];
            generationId?: string | null;
          };
        };
        if (!res.ok) {
          throw new Error(payload.error ?? "提示词生成失败");
        }
        const text =
          payload.prompt ??
          payload.designPrompt?.text ??
          initialPromptForItem(item);
        const now = new Date().toISOString();
        const history =
          payload.designPrompt?.history ??
          pushLocalPromptHistory(promptHistory, {
            text,
            generatedAt: now,
            generationId: payload.designPrompt?.generationId ?? null,
            source: "regenerate",
          });
        setPromptText(text);
        setPromptHistory(history);
        setSyncedPromptHistoryLen(history.length);
        setStaleHint(false);
        setRequirementOpen(false);
        setRequirementDraft("");
        onPromptUpdatedRef.current(item.id, text, {
          history,
          generationId: payload.designPrompt?.generationId ?? null,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "提示词生成失败");
      } finally {
        setLoadingPrompt(false);
      }
    },
    [item, surface, projectId, episodeId, promptHistory, promptModelId],
  );

  const openRequirementDialog = useCallback(() => {
    setRequirementDraft("");
    setRequirementError("");
    setRequirementOpen(true);
  }, []);

  const submitRequirement = useCallback(() => {
    const trimmed = requirementDraft.trim();
    if (!trimmed) {
      setRequirementError("请输入素材要求");
      return;
    }
    if (trimmed.length > 800) {
      setRequirementError("素材要求最多 800 字");
      return;
    }
    void regeneratePrompt(trimmed);
  }, [requirementDraft, regeneratePrompt]);

  const handleCopy = useCallback(async () => {
    setCopyNote("");
    setError("");
    if (!promptText.trim()) {
      setError("提示词为空，无法复制");
      return;
    }
    const fallbackCopy = () => {
      const ta = document.createElement("textarea");
      ta.value = promptText;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (!ok) throw new Error("浏览器拒绝复制");
    };
    try {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(promptText);
        } else {
          fallbackCopy();
        }
      } catch {
        fallbackCopy();
      }
      setCopyNote("提示词已复制");
    } catch (e) {
      setError(e instanceof Error ? e.message : "复制失败");
    }
  }, [promptText]);

  const handleDownload = async () => {
    if (!currentMediaId) {
      setError("暂无可下载图片");
      return;
    }
    setError("");
    try {
      const url = getProjectAssetImageUrl(projectId, currentMediaId, {
        revision: Date.now(),
      });
      const res = await fetch(url);
      if (!res.ok) throw new Error("下载失败");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${item.name || "asset"}-${currentMediaId}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败");
    }
  };

  const handleGenerate = useCallback(async () => {
    if (generateBusy) return;
    setGeneratingAsset(true);
    onGeneratingAssetChange?.(item.id, true);
    setError("");
    setNotice("");
    if (progressClearTimerRef.current != null) {
      window.clearTimeout(progressClearTimerRef.current);
      progressClearTimerRef.current = null;
    }
    try {
      reportProgress({ stage: "validating", percent: 8 });
      const urls = apiBase(surface, projectId, episodeId, item.id);
      reportProgress({ stage: "submitted", percent: 22 });
      reportProgress({ stage: "generating", percent: 38 });
      const res = await fetch(urls.generate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptText,
          idempotencyKey: safeRandomUUID(),
          confirmPaidGeneration: false,
          quality: imageOptions.quality,
          aspectRatio: imageOptions.aspectRatio,
          count: imageOptions.count,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        code?: string;
        notice?: string;
        mediaId?: string;
        generatedMedia?: GeneratedMediaState;
        videoRefSafety?: VideoRefSafety;
        credit?: { chargedPoints: number; balance: number; firstGeneration?: boolean };
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "资产生成失败");
      }
      reportProgress({ stage: "saving", percent: 88 });
      const media = payload.generatedMedia ?? null;
      if (media?.currentId) {
        setPickedMediaId(media.currentId);
        setSyncedMediaCurrentId(media.currentId);
        setLocalHistoryIds((prev) =>
          mergeMediaIdLists(prev, media.historyIds, [media.currentId!]),
        );
      } else if (payload.mediaId) {
        setPickedMediaId(payload.mediaId);
        setSyncedMediaCurrentId(payload.mediaId);
        setLocalHistoryIds((prev) =>
          mergeMediaIdLists(prev, [payload.mediaId!]),
        );
      }
      const safety =
        payload.videoRefSafety ?? media?.videoRefSafety ?? null;
      setVideoRefSafety(safety);
      const now = new Date().toISOString();
      const history = pushLocalPromptHistory(promptHistory, {
        text: promptText,
        generatedAt: now,
        generationId: item.designPrompt?.generationId ?? null,
        source: "generate_asset",
      });
      setPromptHistory(history);
      setSyncedPromptHistoryLen(history.length);
      onPromptUpdated(item.id, promptText, { history });
      onAssetGenerated(item.id, media);
      reportProgress({ stage: "completed", percent: 100 });
      scheduleProgressClear(900);
      setNotice(
        payload.notice ??
          `已生成 ${imageOptions.count} 张 · ${DESIGN_IMAGE_QUALITY_LABELS[imageOptions.quality]} · ${imageOptions.aspectRatio}`,
      );
      setShowImageHistory(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : "资产生成失败";
      setError(message);
      reportProgress({ stage: "failed", percent: 0, message });
      scheduleProgressClear(2200);
    } finally {
      setGeneratingAsset(false);
      onGeneratingAssetChange?.(item.id, false);
    }
  }, [
    item,
    surface,
    projectId,
    episodeId,
    promptText,
    promptHistory,
    imageOptions,
    generateBusy,
    onGeneratingAssetChange,
    onPromptUpdated,
    onAssetGenerated,
    onGenerationProgress,
    reportProgress,
    scheduleProgressClear,
  ]);

  const handleVideoRefPrecheck = useCallback(async () => {
    if (precheckBusy || generateBusy || !currentMediaId) return;
    if (isDesignMediaVideoRefLocked(videoRefSafety)) return;
    setPrecheckBusy(true);
    setError("");
    try {
      const urls = apiBase(surface, projectId, episodeId, item.id);
      const res = await fetch(urls.videoRefPrecheck, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: currentMediaId }),
      });
      const payload = (await res.json()) as {
        error?: string;
        notice?: string;
        videoRefSafety?: VideoRefSafety;
        generatedMedia?: GeneratedMediaState;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "人物校验失败");
      }
      const safety = payload.videoRefSafety ?? null;
      setVideoRefSafety(safety);
      if (payload.generatedMedia) {
        onAssetGenerated(item.id, payload.generatedMedia);
      }
      setNotice(payload.notice ?? "人物校验完成");
    } catch (e) {
      setError(e instanceof Error ? e.message : "人物校验失败");
    } finally {
      setPrecheckBusy(false);
    }
  }, [
    precheckBusy,
    generateBusy,
    currentMediaId,
    surface,
    projectId,
    episodeId,
    item.id,
    onAssetGenerated,
  ]);

  const audioDisabled = item.assetType === "audio";
  const styleBrief =
    item.assetType === "character"
      ? "插画/设定图风格人物参考（避免写实真人剧照）"
      : item.assetType === "prop"
        ? "设定图风格道具参考"
        : item.assetType === "scene"
          ? "设定图风格场景参考"
          : "16:9、4K 素材";
  const emptyPreviewHint = audioDisabled
    ? "当前类型暂不支持图片预览"
    : `点击「生成资产」将按 ${DESIGN_IMAGE_QUALITY_LABELS[imageOptions.quality]} · ${imageOptions.aspectRatio} · ${imageOptions.count}张 生成${styleBrief}`;
  const generateTitle = audioDisabled
    ? "当前未配置该类型的音频生成能力"
    : `文生图 · ${DESIGN_IMAGE_QUALITY_LABELS[imageOptions.quality]} · ${imageOptions.aspectRatio} · ${imageOptions.count}张 · ${styleBrief}`;
  const previewTitle = formatDesignImagePreviewTitle(imageOptions);
  const precheckLabel =
    item.assetType === "character" ? "人物校验" : "参考图校验";

  const safetyForPreview = useMemo(() => {
    if (!currentMediaId) return videoRefSafety;
    const fromHistory = item.generatedMedia?.history?.find(
      (h) => h.mediaId === currentMediaId,
    )?.videoRefSafety;
    if (currentMediaId === item.generatedMedia?.currentId) {
      return videoRefSafety ?? fromHistory ?? item.generatedMedia?.videoRefSafety ?? null;
    }
    return fromHistory ?? null;
  }, [currentMediaId, videoRefSafety, item.generatedMedia]);

  const safetyBadge = designVideoRefSafetyBadge(safetyForPreview);
  const precheckLocked = isDesignMediaVideoRefLocked(safetyForPreview);

  return (
    <>
      <div
        className="ead-modal-backdrop"
        role="presentation"
        onClick={onClose}
        data-testid="design-asset-modal"
      >
        <div
          className="ead-modal ead-modal--wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="ead-modal__head">
            <h2 id={titleId}>设计素材 · {item.name}</h2>
            <button type="button" className="amw-btn" onClick={onClose}>
              关闭
            </button>
          </header>
          {staleHint ? (
            <p className="ead-muted" role="status">
              该提示词基于旧剧本或旧资产描述，可继续编辑或重新生成。
            </p>
          ) : null}
          {loadingPrompt ? (
            <p className="ead-muted" data-testid="design-prompt-loading">
              正在生成提示词…
            </p>
          ) : null}

          <div className="ead-modal__grid">
            <div className="ead-modal__col">
              <div className="ead-modal__section-head">
                <span>素材提示词</span>
                <button
                  type="button"
                  className="amw-btn ead-modal__icon-btn"
                  data-testid="design-prompt-history-toggle"
                  title="提示词历史"
                  onClick={() => setShowPromptHistory((v) => !v)}
                >
                  <History className="h-3.5 w-3.5" />
                  {promptHistory.length > 0 ? (
                    <span className="tabular-nums">{promptHistory.length}</span>
                  ) : null}
                </button>
              </div>
              {showPromptHistory ? (
                <div
                  className="ead-history-strip"
                  data-testid="design-prompt-history"
                >
                  {promptHistory.length === 0 ? (
                    <p className="ead-muted">暂无提示词历史</p>
                  ) : (
                    [...promptHistory].reverse().map((entry, idx) => (
                      <button
                        key={`${entry.generatedAt}-${idx}`}
                        type="button"
                        className="ead-history-chip"
                        onClick={() => {
                          setPromptText(entry.text);
                          setStaleHint(false);
                        }}
                      >
                        <span className="ead-history-chip__meta">
                          {new Date(entry.generatedAt).toLocaleString("zh-CN", {
                            hour12: false,
                          })}
                        </span>
                        <span className="ead-history-chip__text">
                          {entry.text.slice(0, 80)}
                          {entry.text.length > 80 ? "…" : ""}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
              <label className="amw-field">
                <textarea
                  className="amw-textarea"
                  data-testid="design-prompt-textarea"
                  aria-label="素材提示词"
                  value={promptText}
                  disabled={loadingPrompt}
                  rows={12}
                  onChange={(e) => {
                    setPromptText(e.target.value);
                    setStaleHint(false);
                  }}
                />
              </label>
              <div
                className="ead-prompt-actions"
                data-testid="design-prompt-actions"
              >
                <button
                  type="button"
                  className="amw-btn ead-prompt-actions__regenerate"
                  data-testid="design-regenerate-prompt"
                  disabled={loadingPrompt || generateBusy}
                  onClick={openRequirementDialog}
                >
                  {loadingPrompt ? "生成中…" : "重新生成提示词"}
                </button>

                <div
                  className="ead-prompt-actions__model"
                  data-testid="design-prompt-model"
                >
                  <GlassSelect
                    label="提示词模型"
                    hideLabel
                    value={promptModelId}
                    options={DESIGN_PROMPT_MODEL_OPTIONS}
                    disabled={loadingPrompt || generateBusy}
                    menuPortal
                    menuSideOffset={6}
                    menuCollisionPadding={12}
                    onChange={(value) => {
                      if (
                        DESIGN_PROMPT_MODELS.some(
                          (model) => model.id === value,
                        )
                      ) {
                        setPromptModelId(value as DesignPromptModelId);
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="ead-modal__col">
              <div className="ead-modal__section-head">
                <span>{previewTitle}</span>
                <div className="ead-modal__section-actions">
                  <button
                    type="button"
                    className="amw-btn ead-modal__icon-btn"
                    data-testid="design-image-history-toggle"
                    title="图片生成历史"
                    onClick={() => setShowImageHistory((v) => !v)}
                  >
                    <History className="h-3.5 w-3.5" />
                    {imageHistoryIds.length > 0 ? (
                      <span className="tabular-nums">
                        {imageHistoryIds.length}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="amw-btn ead-modal__icon-btn"
                    data-testid="design-download"
                    title="下载图片"
                    disabled={!currentMediaId}
                    onClick={() => void handleDownload()}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  {!audioDisabled ? (
                    <button
                      type="button"
                      className={`amw-btn ead-modal__icon-btn${
                        precheckLocked ? " is-verified" : ""
                      }`}
                      data-testid="design-video-ref-precheck"
                      data-verified={precheckLocked ? "true" : undefined}
                      title={
                        precheckLocked
                          ? "已通过 SD 审核认证，不可重复校验"
                          : `${precheckLabel}：上传至 SD 审核资产库并等待认证`
                      }
                      disabled={
                        !currentMediaId ||
                        generateBusy ||
                        precheckBusy ||
                        precheckLocked
                      }
                      onClick={() => void handleVideoRefPrecheck()}
                    >
                      <ShieldCheck
                        className={`h-3.5 w-3.5${
                          precheckLocked ? " ead-shield-verified" : ""
                        }`}
                        aria-hidden
                      />
                      <span>
                        {precheckBusy
                          ? "校验中…"
                          : precheckLocked
                            ? "已认证"
                            : precheckLabel}
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>
              {!audioDisabled ? (
                <div
                  className="ead-generation-options"
                  data-testid="design-image-generation-options"
                >
                  <div
                    className="ead-generation-option"
                    data-testid="design-image-quality"
                  >
                    <GlassSelect
                      label="画质"
                      value={imageOptions.quality}
                      disabled={generateBusy}
                      options={DESIGN_IMAGE_QUALITY_OPTIONS}
                      menuPortal
                      menuSideOffset={6}
                      menuCollisionPadding={12}
                      onChange={(value) => {
                        setImageOptions((prev) => ({
                          ...prev,
                          quality:
                            value as DesignImageGenerationOptions["quality"],
                        }));
                      }}
                    />
                  </div>

                  <div
                    className="ead-generation-option"
                    data-testid="design-image-aspect-ratio"
                  >
                    <GlassSelect
                      label="比例"
                      value={imageOptions.aspectRatio}
                      disabled={generateBusy}
                      options={DESIGN_IMAGE_RATIO_OPTIONS}
                      menuPortal
                      menuSideOffset={6}
                      menuCollisionPadding={12}
                      onChange={(value) => {
                        setImageOptions((prev) => ({
                          ...prev,
                          aspectRatio:
                            value as DesignImageGenerationOptions["aspectRatio"],
                        }));
                      }}
                    />
                  </div>

                  <div
                    className="ead-generation-option"
                    data-testid="design-image-count"
                  >
                    <GlassSelect
                      label="张数"
                      value={String(imageOptions.count)}
                      disabled={generateBusy}
                      options={DESIGN_IMAGE_COUNT_OPTIONS}
                      menuPortal
                      menuSideOffset={6}
                      menuCollisionPadding={12}
                      onChange={(value) => {
                        const count = Number(value);

                        if (
                          !DESIGN_IMAGE_COUNTS.includes(
                            count as DesignImageGenerationOptions["count"],
                          )
                        ) {
                          return;
                        }

                        setImageOptions((prev) => ({
                          ...prev,
                          count:
                            count as DesignImageGenerationOptions["count"],
                        }));
                      }}
                    />
                  </div>
                </div>
              ) : null}
              <div
                className={
                  previewObjectUrl
                    ? "ead-preview-frame ead-preview-frame--zoomable"
                    : "ead-preview-frame"
                }
                data-testid="design-image-preview"
                role={previewObjectUrl ? "button" : undefined}
                tabIndex={previewObjectUrl ? 0 : undefined}
                aria-label={previewObjectUrl ? "点击放大预览" : undefined}
                onClick={() => {
                  if (previewObjectUrl) setLightboxOpen(true);
                }}
                onKeyDown={(e) => {
                  if (!previewObjectUrl) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setLightboxOpen(true);
                  }
                }}
              >
                {previewLoading ? (
                  <p className="ead-muted">正在加载预览…</p>
                ) : previewObjectUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- blob preview URL */}
                    <img src={previewObjectUrl} alt={`${item.name} 生成预览`} />
                    <span className="ead-preview-hint">点击放大</span>
                    {safetyBadge ? (
                      <span
                        className={`ead-safety-badge is-${safetyBadge.tone}`}
                        data-testid="design-video-ref-safety"
                        data-safety-status={safetyForPreview?.status}
                        title={safetyForPreview?.reason ?? safetyBadge.label}
                      >
                        {safetyBadge.label}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <p className="ead-muted">
                    {currentMediaId
                      ? "预览加载失败，可尝试重新生成或下载排查"
                      : emptyPreviewHint}
                  </p>
                )}
              </div>
              {safetyForPreview?.status === "likely_real_person" ? (
                <p
                  className="ead-safety-warn"
                  role="status"
                  data-testid="design-video-ref-warn"
                >
                  疑似真人：未通过 SD 审核资产库认证。建议改用插画、设定图或三视图后重新生成，再点「人物校验」。
                  {safetyForPreview.reason
                    ? `（${safetyForPreview.reason}）`
                    : ""}
                </p>
              ) : null}
              {showImageHistory ? (
                <div
                  className="ead-history-strip ead-history-strip--images"
                  data-testid="design-image-history"
                >
                  {imageHistoryIds.length === 0 ? (
                    <p className="ead-muted">暂无图片生成历史</p>
                  ) : (
                    [...imageHistoryIds].reverse().map((id) => {
                      const active = id === currentMediaId;
                      return (
                        <button
                          key={id}
                          type="button"
                          className={
                            active
                              ? "ead-history-thumb is-active"
                              : "ead-history-thumb"
                          }
                          onClick={() => {
                            setPickedMediaId(id);
                            const fromHistory =
                              item.generatedMedia?.history?.find(
                                (h) => h.mediaId === id,
                              )?.videoRefSafety ?? null;
                            setVideoRefSafety(fromHistory);
                            if (
                              item.assetType === "character" &&
                              onItemPatched
                            ) {
                              onItemPatched(
                                item.id,
                                withDesignCurrentMediaAndVoiceMirror(
                                  item,
                                  id,
                                ),
                              );
                            }
                          }}
                          title={id}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={getProjectAssetImageUrl(projectId, id, {
                              revision: id,
                            })}
                            alt=""
                            onError={(e) => {
                              (
                                e.currentTarget as HTMLImageElement
                              ).style.opacity = "0.25";
                            }}
                          />
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {copyNote ? (
            <p className="ead-muted" role="status" data-testid="design-copy-ok">
              {copyNote}
            </p>
          ) : null}
          {notice ? (
            <p
              className="ead-muted"
              role="status"
              data-testid="design-gen-notice"
            >
              {notice}
            </p>
          ) : null}
          {error ? (
            <p
              className="ead-error"
              role="alert"
              data-testid="design-modal-error"
            >
              {error}
            </p>
          ) : null}
          <footer className="ead-modal__foot">
            <button
              type="button"
              className="amw-btn amw-btn-primary"
              data-testid="design-copy"
              disabled={
                !promptText.trim() || loadingPrompt || generateBusy
              }
              onClick={() => void handleCopy()}
            >
              一键复制
            </button>
            <button
              type="button"
              className="amw-btn amw-btn-primary"
              data-testid="design-generate-asset"
              disabled={
                loadingPrompt ||
                generateBusy ||
                !promptText.trim() ||
                audioDisabled
              }
              title={generateBusy ? "资产生成中…" : generateTitle}
              onClick={() => void handleGenerate()}
            >
              {generateBusy
                ? "生成中…"
                : audioDisabled
                  ? "生成资产（未配置）"
                  : "生成资产"}
            </button>
          </footer>
        </div>
      </div>
      <DesignImageLightbox
        src={lightboxOpen ? previewObjectUrl : null}
        alt={`${item.name} 放大预览`}
        onClose={() => setLightboxOpen(false)}
      />
      {requirementOpen ? (
        <div
          className="amw-overlay amw-overlay--stacked"
          role="presentation"
          data-testid="design-regenerate-requirement-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !loadingPrompt) {
              setRequirementOpen(false);
            }
          }}
        >
          <div
            className="amw-dialog ead-requirement-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${requirementFieldId}-title`}
          >
            <h3 id={`${requirementFieldId}-title`}>重新生成提示词</h3>
            <p className="amw-dialog-desc">
              输入素材要求。将基于当前资产「{item.name}」并结合你的要求重新生成提示词。
            </p>
            <div className="amw-fields amw-fields--stack">
              <div className="amw-field">
                <label htmlFor={requirementFieldId}>输入素材要求</label>
                <textarea
                  id={requirementFieldId}
                  className="amw-textarea"
                  rows={5}
                  value={requirementDraft}
                  disabled={loadingPrompt}
                  placeholder="例如：更正式的西装、侧光、半身构图…"
                  data-testid="design-regenerate-requirement-input"
                  onChange={(e) => {
                    setRequirementDraft(e.target.value);
                    if (requirementError) setRequirementError("");
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      (e.metaKey || e.ctrlKey) &&
                      !loadingPrompt
                    ) {
                      e.preventDefault();
                      submitRequirement();
                    }
                  }}
                />
              </div>
              {requirementError ? (
                <p className="amw-field-error" role="alert">
                  {requirementError}
                </p>
              ) : null}
            </div>
            <div className="amw-dialog-actions">
              <button
                type="button"
                className="amw-btn"
                disabled={loadingPrompt}
                data-testid="design-regenerate-requirement-cancel"
                onClick={() => setRequirementOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                disabled={loadingPrompt}
                data-testid="design-regenerate-requirement-submit"
                onClick={submitRequirement}
              >
                {loadingPrompt ? "生成中…" : "生成提示词"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function DesignAssetModal(props: DesignAssetModalProps) {
  if (!props.open || !props.item) return null;
  return (
    <DesignAssetModalBody key={props.item.id} {...props} item={props.item} />
  );
}
