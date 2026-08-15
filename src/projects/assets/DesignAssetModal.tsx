"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Download, History, ImagePlus, ShieldCheck, X } from "lucide-react";
import type {
  AssetDesignPromptHistoryEntry,
  EpisodeAssetDesignItem,
  GeneratedMediaState,
} from "@/projects/assets/episode-design/types";
import type { VideoRefSafety } from "@/projects/assets/types";
import { resolveFormalDesignPromptText } from "@/projects/assets/episode-design/format-design-draft-seed";
import {
  designPromptAutoGenKey,
  requestFormalDesignPromptGenerate,
} from "@/projects/assets/episode-design/auto-generate-design-prompts";
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
import { DEFAULT_DESIGN_PROMPT_MODEL_ID } from "@/projects/assets/episode-design/design-prompt-models";
import {
  DEFAULT_DESIGN_IMAGE_MODEL_ID,
  DESIGN_IMAGE_MODELS,
  isDesignImageModelId,
  type DesignImageModelId,
} from "@/projects/assets/episode-design/image-generation-models";
import {
  DESIGN_MULTI_ANGLE_MODES,
  isDesignMultiAngleMode,
  type DesignMultiAngleMode,
} from "@/projects/assets/episode-design/multi-angle-prompts";
import { validateProjectAssetImageFileClient } from "@/projects/assets/upload-asset-image";
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

const DESIGN_IMAGE_MODEL_OPTIONS: GlassSelectOption[] =
  DESIGN_IMAGE_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
  }));

const MULTI_ANGLE_NONE = "__none__";

const DESIGN_MULTI_ANGLE_OPTIONS: GlassSelectOption[] = [
  { id: MULTI_ANGLE_NONE, label: "选择角度…" },
  ...DESIGN_MULTI_ANGLE_MODES.map((mode) => ({
    id: mode.id,
    label: mode.label,
  })),
];

const REFERENCE_SLOT_COUNT = 6;

type ReferenceSlot =
  | {
      source: "generated";
      mediaId: string;
      previewUrl: string;
    }
  | {
      source: "upload";
      file: File;
      previewUrl: string;
    }
  | null;

function emptyReferenceSlots(): ReferenceSlot[] {
  return Array.from({ length: REFERENCE_SLOT_COUNT }, () => null);
}

function compactReferenceSlots(slots: ReferenceSlot[]): ReferenceSlot[] {
  const filled = slots.filter((slot): slot is NonNullable<ReferenceSlot> =>
    Boolean(slot),
  );
  return [
    ...filled,
    ...Array.from(
      { length: Math.max(0, REFERENCE_SLOT_COUNT - filled.length) },
      () => null,
    ),
  ].slice(0, REFERENCE_SLOT_COUNT);
}

function revokeUploadPreview(slot: ReferenceSlot) {
  if (slot?.source === "upload" && slot.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(slot.previewUrl);
  }
}

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
  /** Asset-library context keeps the prompt/generation surface but removes image-to-image editing. */
  hideImageEdit?: boolean;
  /** Development preview uses the same progress/disabled animation without auth-backed generation. */
  previewMode?: boolean;
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

function pushLocalPromptHistory(
  prev: AssetDesignPromptHistoryEntry[] | undefined,
  entry: AssetDesignPromptHistoryEntry,
): AssetDesignPromptHistoryEntry[] {
  return appendPromptHistory(prev, entry);
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
  hideImageEdit = false,
  previewMode = false,
}: DesignAssetModalBodyProps) {
  const titleId = useId();
  const formalPrompt = resolveFormalDesignPromptText(item);
  const formalPromptMissing = !formalPrompt;
  const serverPromptGenerating = item.designPrompt?.status === "generating";

  const [promptText, setPromptText] = useState(formalPrompt);
  const [syncedFormalPrompt, setSyncedFormalPrompt] = useState(formalPrompt);
  if (formalPrompt !== syncedFormalPrompt) {
    setSyncedFormalPrompt(formalPrompt);
    if (formalPrompt) {
      setPromptText(formalPrompt);
    } else if (!serverPromptGenerating) {
      setPromptText("");
    }
  }
  const [promptHistory, setPromptHistory] = useState<
    AssetDesignPromptHistoryEntry[]
  >(item.designPrompt?.history ?? []);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const promptBusy = loadingPrompt || serverPromptGenerating;
  const [generatingAsset, setGeneratingAsset] = useState(false);
  const generateBusy = generatingAsset || isGeneratingAsset;
  const autoPromptKeyRef = useRef<string | null>(null);
  useGenerationBusy(
    generateBusy || promptBusy,
    `design-modal-${item.id}`,
    promptBusy ? "资产提示词生成" : "资产图生成",
  );
  const [copyNote, setCopyNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [imageOptions, setImageOptions] = useState<DesignImageGenerationOptions>(
    DEFAULT_DESIGN_IMAGE_OPTIONS,
  );
  const [imageModelId, setImageModelId] = useState<DesignImageModelId>(
    DEFAULT_DESIGN_IMAGE_MODEL_ID,
  );
  const [multiAngleSelect, setMultiAngleSelect] = useState(MULTI_ANGLE_NONE);
  const [imageEditOpen, setImageEditOpen] = useState(false);
  const [imageEditPrompt, setImageEditPrompt] = useState("");
  const [referenceSlots, setReferenceSlots] = useState<ReferenceSlot[]>(
    emptyReferenceSlots,
  );
  const referenceFileInputRefs = useRef<Array<HTMLInputElement | null>>(
    Array.from({ length: REFERENCE_SLOT_COUNT }, () => null),
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

  const autoGenerateFormalPrompt = useCallback(async () => {
    setLoadingPrompt(true);
    setError("");
    setCopyNote("");
    onItemPatched?.(item.id, {
      ...item,
      designPrompt: {
        status: "generating",
        text: resolveFormalDesignPromptText(item) || "",
        generationId: item.designPrompt?.generationId ?? null,
        sourceFingerprint: item.designPrompt?.sourceFingerprint ?? null,
        generatedAt: item.designPrompt?.generatedAt ?? null,
        updatedAt: new Date().toISOString(),
        errorMessage: null,
        history: item.designPrompt?.history ?? promptHistory,
      },
    });
    try {
      const result = await requestFormalDesignPromptGenerate({
        surface,
        projectId,
        episodeId,
        item,
        userRequirement: "",
        promptModelId: DEFAULT_DESIGN_PROMPT_MODEL_ID,
      });
      const now = new Date().toISOString();
      const history =
        result.history.length > 0
          ? result.history
          : pushLocalPromptHistory(promptHistory, {
              text: result.text,
              generatedAt: now,
              generationId: result.generationId,
              source: "regenerate",
            });
      setPromptText(result.text);
      setPromptHistory(history);
      setSyncedPromptHistoryLen(history.length);
      setStaleHint(false);
      onPromptUpdatedRef.current(item.id, result.text, {
        history,
        generationId: result.generationId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "提示词生成失败");
      onItemPatched?.(item.id, {
        ...item,
        designPrompt: {
          status: "failed",
          text: resolveFormalDesignPromptText(item) || "",
          generationId: item.designPrompt?.generationId ?? null,
          sourceFingerprint: item.designPrompt?.sourceFingerprint ?? null,
          generatedAt: item.designPrompt?.generatedAt ?? null,
          updatedAt: new Date().toISOString(),
          errorMessage: e instanceof Error ? e.message : "提示词生成失败",
          history: item.designPrompt?.history ?? promptHistory,
        },
      });
    } finally {
      setLoadingPrompt(false);
    }
  }, [item, surface, projectId, episodeId, promptHistory, onItemPatched]);

  const autoGenerateFormalPromptRef = useRef(autoGenerateFormalPrompt);
  useEffect(() => {
    autoGenerateFormalPromptRef.current = autoGenerateFormalPrompt;
  }, [autoGenerateFormalPrompt]);

  /** Missing formal prompt: auto-generate once per item+fingerprint. */
  useEffect(() => {
    if (!formalPromptMissing) return;
    if (promptText.trim()) return;
    const key = designPromptAutoGenKey(item, DEFAULT_DESIGN_PROMPT_MODEL_ID);
    if (autoPromptKeyRef.current === key) return;
    autoPromptKeyRef.current = key;
    if (serverPromptGenerating) return;
    void autoGenerateFormalPromptRef.current();
  }, [formalPromptMissing, promptText, item, serverPromptGenerating]);

  const revokeAllUploadPreviews = useCallback((slots: ReferenceSlot[]) => {
    for (const slot of slots) revokeUploadPreview(slot);
  }, []);

  const referenceSlotsRef = useRef(referenceSlots);
  useEffect(() => {
    referenceSlotsRef.current = referenceSlots;
  }, [referenceSlots]);
  useEffect(() => {
    return () => {
      revokeAllUploadPreviews(referenceSlotsRef.current);
    };
  }, [revokeAllUploadPreviews]);

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

  const handleGenerate = useCallback(async (opts?: {
    multiAngleMode?: DesignMultiAngleMode;
  }) => {
    if (generateBusy) return;
    const multiAngleMode = opts?.multiAngleMode;
    const isMultiAngle = Boolean(multiAngleMode);
    const activePrompt = imageEditOpen || isMultiAngle
      ? imageEditPrompt.trim()
      : promptText.trim();
    if (!isMultiAngle && !activePrompt) {
      setError(imageEditOpen ? "请填写二次编辑要求" : "提示词为空，无法生成");
      return;
    }
    if ((imageEditOpen || isMultiAngle) && !referenceSlots.some(Boolean)) {
      setError(isMultiAngle ? "请先生成或上传场景参考图" : "缺少参考图片");
      return;
    }
    if (isMultiAngle && !referenceSlots[0]) {
      setError("请先生成或上传场景参考图");
      return;
    }
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

      if (previewMode) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 1400);
        });
        const now = new Date().toISOString();
        const history = pushLocalPromptHistory(promptHistory, {
          text: activePrompt,
          generatedAt: now,
          generationId: null,
          source: "generate_asset",
        });
        setPromptHistory(history);
        setSyncedPromptHistoryLen(history.length);
        onPromptUpdated(item.id, activePrompt, { history });
        reportProgress({ stage: "completed", percent: 100 });
        scheduleProgressClear(900);
        setNotice(`已生成 ${imageOptions.count} 张 · ${DESIGN_IMAGE_QUALITY_LABELS[imageOptions.quality]} · ${imageOptions.aspectRatio}`);
        setShowImageHistory(true);
        return;
      }

      let res: Response;
      if (imageEditOpen || isMultiAngle) {
        const form = new FormData();
        form.set("mode", "image_to_image");
        form.set("model", imageModelId);
        form.set("prompt", activePrompt);
        form.set("idempotencyKey", safeRandomUUID());
        form.set("quality", imageOptions.quality);
        form.set("aspectRatio", imageOptions.aspectRatio);
        form.set("count", String(imageOptions.count));
        if (multiAngleMode) {
          form.set("multiAngleMode", multiAngleMode);
        }
        const slotsToSend = multiAngleMode
          ? referenceSlots.slice(0, 1)
          : referenceSlots;
        slotsToSend.forEach((slot, index) => {
          if (!slot) return;
          if (slot.source === "generated") {
            form.set(`referenceMediaId[${index}]`, slot.mediaId);
          } else {
            form.set(`referenceImage[${index}]`, slot.file);
          }
        });
        res = await fetch(urls.generate, { method: "POST", body: form });
      } else {
        res = await fetch(urls.generate, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: activePrompt,
            model: imageModelId,
            idempotencyKey: safeRandomUUID(),
            confirmPaidGeneration: false,
            quality: imageOptions.quality,
            aspectRatio: imageOptions.aspectRatio,
            count: imageOptions.count,
          }),
        });
      }
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
      const nextMediaId = media?.currentId ?? payload.mediaId ?? null;
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
      if ((imageEditOpen || isMultiAngle) && nextMediaId) {
        setReferenceSlots((prev) => {
          const kept = prev.slice(1);
          return compactReferenceSlots([
            {
              source: "generated",
              mediaId: nextMediaId,
              previewUrl: getProjectAssetImageUrl(projectId, nextMediaId, {
                revision: Date.now(),
              }),
            },
            ...kept,
          ]);
        });
      }
      if (isMultiAngle) {
        setMultiAngleSelect(MULTI_ANGLE_NONE);
      }
      const safety =
        payload.videoRefSafety ?? media?.videoRefSafety ?? null;
      setVideoRefSafety(safety);
      const now = new Date().toISOString();
      const history = pushLocalPromptHistory(promptHistory, {
        text: activePrompt || promptText,
        generatedAt: now,
        generationId: item.designPrompt?.generationId ?? null,
        source: "generate_asset",
      });
      setPromptHistory(history);
      setSyncedPromptHistoryLen(history.length);
      if (!imageEditOpen && !isMultiAngle) {
        onPromptUpdated(item.id, activePrompt, { history });
      } else {
        onPromptUpdated(item.id, promptText, { history });
      }
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
      if (isMultiAngle) {
        setMultiAngleSelect(MULTI_ANGLE_NONE);
      }
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
    imageEditOpen,
    imageEditPrompt,
    referenceSlots,
    imageModelId,
    promptHistory,
    imageOptions,
    generateBusy,
    onGeneratingAssetChange,
    onPromptUpdated,
    onAssetGenerated,
    reportProgress,
    scheduleProgressClear,
    previewMode,
  ]);

  const handleMultiAngleChange = useCallback(
    (value: string) => {
      if (value === MULTI_ANGLE_NONE || !isDesignMultiAngleMode(value)) {
        setMultiAngleSelect(MULTI_ANGLE_NONE);
        return;
      }
      if (!referenceSlots[0]) {
        setError("请先生成或上传场景参考图");
        setMultiAngleSelect(MULTI_ANGLE_NONE);
        return;
      }
      setMultiAngleSelect(value);
      void handleGenerate({ multiAngleMode: value });
    },
    [handleGenerate, referenceSlots],
  );

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
    videoRefSafety,
    surface,
    projectId,
    episodeId,
    item.id,
    onAssetGenerated,
  ]);

  const audioDisabled = item.assetType === "audio";
  const imageEditEnabled = Boolean(currentMediaId) && !audioDisabled;
  const activePrompt = imageEditOpen
    ? imageEditPrompt.trim()
    : promptText.trim();
  const styleBrief =
    item.assetType === "character"
      ? "超写实真人影视摄影质感的虚构角色参考（禁止复刻现实可识别个人）"
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
    : imageEditOpen
      ? `图生图 · ${DESIGN_IMAGE_QUALITY_LABELS[imageOptions.quality]} · ${imageOptions.aspectRatio} · ${imageOptions.count}张`
      : `文生图 · ${DESIGN_IMAGE_QUALITY_LABELS[imageOptions.quality]} · ${imageOptions.aspectRatio} · ${imageOptions.count}张 · ${styleBrief}`;
  const previewTitle = formatDesignImagePreviewTitle(imageOptions);
  const precheckLabel =
    item.assetType === "character" ? "人物校验" : "参考图校验";
  const filledReferenceCount = referenceSlots.filter(Boolean).length;

  const handleReferenceSlotUpload = useCallback(
    (clickIndex: number, fileList: FileList | null) => {
      const file = fileList?.[0];
      if (!file) return;
      const validationError = validateProjectAssetImageFileClient(file);
      if (validationError) {
        setError(validationError);
        return;
      }
      setError("");
      const previewUrl = URL.createObjectURL(file);
      setReferenceSlots((prev) => {
        const next = [...prev];
        const firstEmpty = next.findIndex((slot) => !slot);
        const target =
          next[clickIndex] != null
            ? clickIndex
            : firstEmpty === -1
              ? clickIndex
              : clickIndex > firstEmpty
                ? firstEmpty
                : clickIndex;
        revokeUploadPreview(next[target] ?? null);
        next[target] = { source: "upload", file, previewUrl };
        return compactReferenceSlots(next);
      });
      const input = referenceFileInputRefs.current[clickIndex];
      if (input) input.value = "";
    },
    [],
  );

  const removeReferenceSlot = useCallback((index: number) => {
    setReferenceSlots((prev) => {
      const next = [...prev];
      revokeUploadPreview(next[index] ?? null);
      next[index] = null;
      return compactReferenceSlots(next);
    });
  }, []);

  const toggleImageEditPanel = useCallback(() => {
    if (!imageEditEnabled || generateBusy) return;
    setImageEditOpen((open) => {
      if (open) return false;
      const previewUrl = currentMediaId
        ? previewObjectUrl ??
          getProjectAssetImageUrl(projectId, currentMediaId, {
            revision: currentMediaId,
          })
        : null;
      setReferenceSlots(
        compactReferenceSlots([
          currentMediaId && previewUrl
            ? {
                source: "generated",
                mediaId: currentMediaId,
                previewUrl,
              }
            : null,
          ...Array.from({ length: REFERENCE_SLOT_COUNT - 1 }, () => null),
        ]),
      );
      return true;
    });
  }, [
    imageEditEnabled,
    generateBusy,
    currentMediaId,
    previewObjectUrl,
    projectId,
  ]);

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

  const previewBlock = (
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
  );

  const imageOptionsBlock = !audioDisabled ? (
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
              quality: value as DesignImageGenerationOptions["quality"],
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
              count: count as DesignImageGenerationOptions["count"],
            }));
          }}
        />
      </div>

      <div
        className="ead-generation-option"
        data-testid="design-image-model"
      >
        <GlassSelect
          label="模型"
          value={imageModelId}
          options={DESIGN_IMAGE_MODEL_OPTIONS}
          disabled={generateBusy}
          menuPortal
          menuSideOffset={6}
          menuCollisionPadding={12}
          onChange={(value) => {
            if (isDesignImageModelId(value)) {
              setImageModelId(value);
            }
          }}
        />
      </div>
    </div>
  ) : null;

  const imageHistoryBlock = showImageHistory ? (
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
                active ? "ead-history-thumb is-active" : "ead-history-thumb"
              }
              onClick={() => {
                setPickedMediaId(id);
                const fromHistory =
                  item.generatedMedia?.history?.find(
                    (h) => h.mediaId === id,
                  )?.videoRefSafety ?? null;
                setVideoRefSafety(fromHistory);
                if (item.assetType === "character" && onItemPatched) {
                  onItemPatched(
                    item.id,
                    withDesignCurrentMediaAndVoiceMirror(item, id),
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
                  (e.currentTarget as HTMLImageElement).style.opacity = "0.25";
                }}
              />
            </button>
          );
        })
      )}
    </div>
  ) : null;

  return (
    <>
      <div
        className="ead-modal-backdrop"
        role="presentation"
        onClick={onClose}
        data-testid="design-asset-modal"
      >
        <div
          className={`ead-modal-stage${imageEditOpen ? " is-image-editing" : ""}`}
          data-testid="design-modal-stage"
          onClick={(e) => e.stopPropagation()}
        >
        <div
          className="ead-modal ead-modal--wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
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
          {promptBusy ? (
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
                  placeholder={
                    promptBusy
                      ? "正在生成提示词…"
                      : formalPromptMissing
                        ? "尚未生成"
                        : "正式素材提示词"
                  }
                  value={promptText}
                  disabled={promptBusy}
                  rows={12}
                  onChange={(e) => {
                    setPromptText(e.target.value);
                    setStaleHint(false);
                  }}
                />
              </label>
              {formalPromptMissing && !promptText.trim() && !promptBusy ? (
                <p
                  className="ead-muted"
                  data-testid="design-prompt-not-generated"
                >
                  尚未生成
                </p>
              ) : null}
              {!hideImageEdit ? (
                <div
                  className="ead-prompt-copy-row"
                  data-testid="design-prompt-copy-row"
                >
                  <button
                    type="button"
                    className="amw-btn amw-btn-primary"
                    data-testid="design-copy"
                    disabled={
                      !promptText.trim() || promptBusy || generateBusy
                    }
                    onClick={() => void handleCopy()}
                  >
                    一键复制
                  </button>
                </div>
              ) : null}
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

              {previewBlock}

              {imageOptionsBlock}

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

              {imageHistoryBlock}
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
          <footer
            className={`ead-modal__foot${hideImageEdit ? " ead-modal__foot--split" : ""}`}
          >
            {hideImageEdit ? (
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                data-testid="design-copy"
                disabled={!promptText.trim() || promptBusy || generateBusy}
                onClick={() => void handleCopy()}
              >
                一键复制
              </button>
            ) : (
              <button
                type="button"
                className={`amw-btn${imageEditOpen || imageEditEnabled ? " amw-btn-primary" : ""}`}
                data-testid="design-image-edit-toggle"
                disabled={!imageEditEnabled || generateBusy}
                aria-pressed={imageEditOpen}
                title={
                  imageEditEnabled
                    ? imageEditOpen
                      ? "关闭二次编辑"
                      : "打开二次编辑"
                    : "生成图片后可进行二次编辑"
                }
                onClick={toggleImageEditPanel}
              >
                二次编辑
              </button>
            )}
            {!imageEditOpen ? (
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                data-testid="design-generate-asset"
                disabled={
                  promptBusy ||
                  generateBusy ||
                  !activePrompt ||
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
            ) : null}
          </footer>
        </div>
        {!hideImageEdit && imageEditOpen ? (
          <aside
            className="ead-image-edit-panel"
            data-testid="design-image-edit-panel"
            aria-label="二次编辑"
          >
            <div className="ead-image-edit-panel__head">二次编辑</div>
            <div
              className="ead-reference-slots"
              data-testid="design-reference-slots"
            >
              {referenceSlots.map((slot, index) => (
                <div
                  key={`ref-slot-${index}`}
                  className={`ead-reference-slot${slot ? " is-filled" : ""}`}
                  data-testid={`design-reference-slot-${index + 1}`}
                >
                  <button
                    type="button"
                    className="ead-reference-slot__hit"
                    disabled={generateBusy}
                    title={slot ? `替换第${index + 1}张参考图` : `上传第${index + 1}张参考图`}
                    onClick={() => {
                      referenceFileInputRefs.current[index]?.click();
                    }}
                  >
                    <span className="ead-reference-slot__index" aria-hidden>
                      {index + 1}
                    </span>
                    {slot ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={slot.previewUrl}
                        alt={`参考图 ${index + 1}`}
                      />
                    ) : (
                      <ImagePlus
                        className="ead-reference-slot__empty-icon"
                        aria-hidden
                      />
                    )}
                  </button>
                  {slot ? (
                    <button
                      type="button"
                      className="ead-reference-slot__remove"
                      data-testid={`design-reference-slot-remove-${index + 1}`}
                      title={`删除第${index + 1}张参考图`}
                      disabled={generateBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeReferenceSlot(index);
                      }}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : null}
                  <input
                    ref={(el) => {
                      referenceFileInputRefs.current[index] = el;
                    }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    className="ead-reference-slot__file"
                    data-testid={`design-reference-slot-file-${index + 1}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      handleReferenceSlotUpload(index, e.target.files);
                    }}
                  />
                </div>
              ))}
            </div>
            <label className="amw-field">
              <span>二次编辑要求</span>
              <textarea
                className="amw-textarea"
                data-testid="design-image-edit-prompt"
                aria-label="二次编辑要求"
                placeholder="例如：保留第1张的人脸，使用第2张的服装，参考第3张的灯光和背景"
                value={imageEditPrompt}
                rows={8}
                disabled={generateBusy}
                onChange={(e) => setImageEditPrompt(e.target.value)}
              />
            </label>
            {item.assetType === "scene" ? (
              <div
                className="ead-multi-angle"
                data-testid="design-multi-angle"
              >
                <GlassSelect
                  label="多角度生图"
                  value={multiAngleSelect}
                  options={DESIGN_MULTI_ANGLE_OPTIONS}
                  disabled={generateBusy || !referenceSlots[0]}
                  menuPortal
                  menuSideOffset={6}
                  menuCollisionPadding={12}
                  onChange={handleMultiAngleChange}
                />
                {!referenceSlots[0] ? (
                  <p
                    className="ead-muted"
                    data-testid="design-multi-angle-hint"
                  >
                    请先生成或上传场景参考图
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="ead-image-edit-panel__foot">
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                data-testid="design-generate-asset"
                disabled={
                  promptBusy ||
                  generateBusy ||
                  !activePrompt ||
                  audioDisabled ||
                  filledReferenceCount === 0
                }
                title={generateBusy ? "资产生成中…" : generateTitle}
                onClick={() => void handleGenerate()}
              >
                {generateBusy ? "生成中…" : "生成资产"}
              </button>
            </div>
          </aside>
        ) : null}
        </div>
      </div>
      <DesignImageLightbox
        src={lightboxOpen ? previewObjectUrl : null}
        alt={`${item.name} 放大预览`}
        onClose={() => setLightboxOpen(false)}
      />
    </>
  );
}

export function DesignAssetModal(props: DesignAssetModalProps) {
  if (!props.open || !props.item) return null;
  return (
    <DesignAssetModalBody key={props.item.id} {...props} item={props.item} />
  );
}
