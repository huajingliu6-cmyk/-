"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { Download, History, ImagePlus, Settings2, ShieldCheck, X } from "lucide-react";
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
import { MediaHistoryStrip } from "@/projects/ui/MediaHistoryStrip";
import {
  CompactPromptReferenceSlots,
  emptyCompactPromptReferenceSlots,
  type CompactPromptReferenceSlot,
} from "@/projects/assets/CompactPromptReferenceSlots";
import { DesignImageLightbox } from "@/projects/assets/DesignImageLightbox";
import { useGenerationBusy } from "@/shell/GenerationBusyGuard";
import { safeRandomUUID } from "@/lib/safe-random-id";
import type { AssetGenerationProgress } from "@/projects/assets/DesignGenerationOverlay";
import { DesignGenerationOverlay } from "@/projects/assets/DesignGenerationOverlay";
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
import { useLibraryImageGenerationJob } from "@/projects/assets/image-generation/useLibraryImageGenerationJob";
import { ImageGenerationTaskPanel } from "@/projects/assets/image-generation/ImageGenerationTaskPanel";
import { appendGeneratedMediaGenerations } from "@/projects/assets/episode-design/generated-media-history";
import { parseResponseJson } from "@/projects/assets/parse-response-json";

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

function revokeCompactUploadPreview(slot: CompactPromptReferenceSlot): void {
  if (slot?.source === "upload" && slot.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(slot.previewUrl);
  }
}

function appendLibraryCompactReferencesToForm(
  form: FormData,
  slots: CompactPromptReferenceSlot[],
): boolean {
  let hasRefs = false;
  const referenceSources: Array<Record<string, unknown>> = [];
  slots.forEach((slot, index) => {
    if (!slot) return;
    hasRefs = true;
    if (slot.source === "generated") {
      referenceSources.push({
        slot: index,
        sourceType: "project-asset",
        mediaId: slot.mediaId,
      });
      form.set(`referenceMediaId[${index}]`, slot.mediaId);
      return;
    }
    if (slot.source === "upload") {
      referenceSources.push({ slot: index, sourceType: "upload" });
      form.set(`referenceImage[${index}]`, slot.file);
      return;
    }
    if (slot.source === "personal-material") {
      referenceSources.push({
        slot: index,
        sourceType: "personal-material",
        personalMaterialId: slot.personalMaterialId,
      });
      return;
    }
    referenceSources.push({
      slot: index,
      sourceType: "system-material",
      materialId: slot.materialId,
      personalMaterialId: slot.personalMaterialId,
    });
  });
  if (referenceSources.length > 0) {
    form.set("referenceSources", JSON.stringify(referenceSources));
  }
  return hasRefs;
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
  /**
   * Character detail embeds history/download/validation on the hero image.
   * Hide the duplicate media toolbar in the「生成预览」row when true.
   */
  hideMediaToolbar?: boolean;
  /**
   * Character detail already shows a compact object badge.
   * Hide the embedded「素材提示词」section label to avoid duplicate titles.
   */
  hidePromptSectionLabel?: boolean;
  /**
   * Compact object label shown where prompt-history used to sit
   * (e.g. 主形象 / 少年态). When set, hides「素材提示词」title.
   */
  promptContextLabel?: string | null;
  /** Prefer host toast / status channel over inline footer notes. */
  onStatus?: (message: string) => void;
  /** modal = dialog overlay; embedded = inline panel for character library page. */
  variant?: "modal" | "embedded";
  /** Notify host when preview/history/generate switches the active media id. */
  onCurrentMediaChange?: (mediaId: string | null) => void;
  /** Host tracks unsaved prompt edits in embedded library panels. */
  onPromptDirtyChange?: (dirty: boolean) => void;
  /** Host can flush the current prompt text before save/navigation. */
  promptFlushRef?: MutableRefObject<(() => Promise<void>) | null>;
};

function apiBase(
  surface: DesignAssetModalProps["surface"],
  projectId: string,
  episodeId: string,
  itemId: string,
): { prompt: string; generate: string; videoRefPrecheck: string; projectRoot: string } {
  const enc = encodeURIComponent;
  const projectRoot =
    surface === "workspace"
      ? `/api/workspace/projects/${enc(projectId)}`
      : `/api/projects/${enc(projectId)}`;
  if (surface === "workspace") {
    const root = `${projectRoot}/asset-designs/episodes/${enc(episodeId)}/items/${enc(itemId)}`;
    return {
      prompt: `${root}/generate-prompt`,
      generate: `${root}/generate-asset`,
      videoRefPrecheck: `${root}/video-ref-precheck`,
      projectRoot,
    };
  }
  const root = `${projectRoot}/asset-designs/episodes/${enc(episodeId)}/items/${enc(itemId)}`;
  return {
    prompt: `${root}/generate-prompt`,
    generate: `${root}/generate-asset`,
    videoRefPrecheck: `${root}/video-ref-precheck`,
    projectRoot,
  };
}

function resolveLibraryGenerateTarget(
  item: EpisodeAssetDesignItem,
  hideImageEdit: boolean,
): { assetId: string; assetKind: "character" | "scene" | "prop" } | null {
  if (!hideImageEdit) return null;
  if (
    item.assetType !== "character" &&
    item.assetType !== "scene" &&
    item.assetType !== "prop"
  ) {
    return null;
  }
  const assetId = (item.libraryAssetId ?? item.existingAssetId ?? "").trim();
  if (!assetId) return null;
  return { assetId, assetKind: item.assetType };
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
  hideMediaToolbar = false,
  hidePromptSectionLabel = false,
  promptContextLabel = null,
  onStatus,
  variant = "modal",
  onCurrentMediaChange,
  onPromptDirtyChange,
  promptFlushRef,
}: DesignAssetModalBodyProps) {
  const titleId = useId();
  const isEmbedded = variant === "embedded";
  const formalPrompt = resolveFormalDesignPromptText(item);
  const formalPromptMissing = !formalPrompt;
  const serverPromptGenerating = item.designPrompt?.status === "generating";

  const [promptText, setPromptText] = useState(formalPrompt);
  const committedPromptRef = useRef(formalPrompt);
  const [syncedFormalPrompt, setSyncedFormalPrompt] = useState(formalPrompt);
  if (formalPrompt !== syncedFormalPrompt) {
    setSyncedFormalPrompt(formalPrompt);
    if (formalPrompt) {
      setPromptText(formalPrompt);
      committedPromptRef.current = formalPrompt;
    } else if (!serverPromptGenerating) {
      setPromptText("");
      committedPromptRef.current = "";
    }
  }
  const [promptHistory, setPromptHistory] = useState<
    AssetDesignPromptHistoryEntry[]
  >(item.designPrompt?.history ?? []);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const promptBusy = loadingPrompt || serverPromptGenerating;
  const [generatingAsset, setGeneratingAsset] = useState(false);
  const [generationProgress, setGenerationProgress] =
    useState<AssetGenerationProgress | null>(null);
  const libraryGenerateTarget = useMemo(
    () => resolveLibraryGenerateTarget(item, hideImageEdit),
    [hideImageEdit, item],
  );
  const imageJob = useLibraryImageGenerationJob({
    projectId,
    context: surface === "workspace" ? "workspace" : "management",
    assetId: libraryGenerateTarget?.assetId ?? item.id,
    assetKind: libraryGenerateTarget?.assetKind ?? "design_item",
    enabled: true,
  });
  const generateBusy =
    generatingAsset || isGeneratingAsset || imageJob.generationBlocked;
  const autoPromptKeyRef = useRef<string | null>(null);
  const appliedJobResultRef = useRef<string | null>(null);
  const generateInFlightRef = useRef(false);
  const lastStatusRef = useRef<string | null>(null);
  useGenerationBusy(
    generateBusy || promptBusy,
    `design-modal-${item.id}`,
    promptBusy ? "资产提示词生成" : "资产图生成",
  );
  const [copyNote, setCopyNote] = useState("");
  const [paramsOpen, setParamsOpen] = useState(false);
  const paramsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const paramsPanelRef = useRef<HTMLDivElement | null>(null);
  const [paramsPanelStyle, setParamsPanelStyle] = useState<Record<string, string | number>>({});
  const [paramsPlaced, setParamsPlaced] = useState(false);
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
  const [libraryReferenceSlots, setLibraryReferenceSlots] = useState(
    emptyCompactPromptReferenceSlots,
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
      setGenerationProgress(progress);
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
        setGenerationProgress(null);
        onGenerationProgress?.(item.id, null);
      }, delayMs);
    },
    [item.id, onGenerationProgress],
  );

  const incomingMedia = item.generatedMedia;
  const incomingCurrentId = incomingMedia?.currentId ?? null;
  if (incomingCurrentId !== syncedMediaCurrentId) {
    setSyncedMediaCurrentId(incomingCurrentId);
    // Only clear an explicit pick when host media advances to a *different* id.
    // Clearing when incoming equals the pick forces a needless preview reload.
    if (incomingCurrentId && incomingCurrentId !== pickedMediaId) {
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

  const onCurrentMediaChangeRef = useRef(onCurrentMediaChange);
  useEffect(() => {
    onCurrentMediaChangeRef.current = onCurrentMediaChange;
  }, [onCurrentMediaChange]);

  const lastNotifiedMediaIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // Notify only when the media id value changes — never when parent re-creates the callback.
    if (lastNotifiedMediaIdRef.current === currentMediaId) return;
    lastNotifiedMediaIdRef.current = currentMediaId;
    onCurrentMediaChangeRef.current?.(currentMediaId);
  }, [currentMediaId]);

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
          revision: currentMediaId,
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
    if (item.designPrompt?.status === "idle") return;
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
  const libraryReferenceSlotsRef = useRef(libraryReferenceSlots);
  useEffect(() => {
    referenceSlotsRef.current = referenceSlots;
  }, [referenceSlots]);
  useEffect(() => {
    libraryReferenceSlotsRef.current = libraryReferenceSlots;
  }, [libraryReferenceSlots]);
  useEffect(() => {
    return () => {
      revokeAllUploadPreviews(referenceSlotsRef.current);
      libraryReferenceSlotsRef.current.forEach(revokeCompactUploadPreview);
    };
  }, [revokeAllUploadPreviews]);

  const reportStatus = useCallback(
    (message: string, kind: "info" | "error" = "info") => {
      const text = String(message ?? "").trim();
      if (!text) return;
      if (lastStatusRef.current === text) return;
      lastStatusRef.current = text;
      if (onStatus) {
        onStatus(text);
        return;
      }
      if (kind === "error") setError(text);
      else if (text.includes("已复制")) setCopyNote(text);
      else setNotice(text);
    },
    [onStatus],
  );

  const compactGenerationChrome = isEmbedded && hideImageEdit;
  const showLibraryCompactReferences =
    compactGenerationChrome && Boolean(libraryGenerateTarget);
  const libraryImageToImage =
    showLibraryCompactReferences && libraryReferenceSlots.some(Boolean);

  const flushPrompt = useCallback(async () => {
    const text = promptText.trim();
    const committed = committedPromptRef.current.trim();
    if (!text || text === committed) {
      onPromptDirtyChange?.(false);
      return;
    }
    await Promise.resolve(
      onPromptUpdated(item.id, text, {
        history: promptHistory,
        generationId: item.designPrompt?.generationId ?? null,
      }),
    );
    committedPromptRef.current = text;
    onPromptDirtyChange?.(false);
  }, [
    item.designPrompt?.generationId,
    item.id,
    onPromptDirtyChange,
    onPromptUpdated,
    promptHistory,
    promptText,
  ]);

  useEffect(() => {
    if (!promptFlushRef) return;
    promptFlushRef.current = flushPrompt;
    return () => {
      if (promptFlushRef.current === flushPrompt) {
        promptFlushRef.current = null;
      }
    };
  }, [flushPrompt, promptFlushRef]);

  useEffect(() => {
    onPromptDirtyChange?.(
      promptText.trim() !== committedPromptRef.current.trim(),
    );
  }, [onPromptDirtyChange, promptText]);

  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    if (!onStatusRef.current) return;
    const text = error.trim();
    if (!text) return;
    if (lastStatusRef.current === text) return;
    lastStatusRef.current = text;
    onStatusRef.current(text);
  }, [error]);
  useEffect(() => {
    if (!onStatusRef.current) return;
    const text = notice.trim();
    if (!text) return;
    if (lastStatusRef.current === text) return;
    lastStatusRef.current = text;
    onStatusRef.current(text);
  }, [notice]);
  useEffect(() => {
    if (!onStatusRef.current) return;
    const text = copyNote.trim();
    if (!text) return;
    if (lastStatusRef.current === text) return;
    lastStatusRef.current = text;
    onStatusRef.current(text);
  }, [copyNote]);

  const placeParamsPanel = useCallback(() => {
    const trigger = paramsTriggerRef.current;
    const panel = paramsPanelRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 24);
    let left = rect.right - width;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    const panelH = Math.max(panel?.offsetHeight || 0, 300);
    let top = rect.bottom + 8;
    if (top + panelH > window.innerHeight - 12) {
      top = rect.top - panelH - 8;
    }
    top = Math.max(12, Math.min(top, window.innerHeight - panelH - 12));
    setParamsPanelStyle({
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
    });
    setParamsPlaced(true);
  }, []);

  useLayoutEffect(() => {
    if (!paramsOpen) {
      setParamsPlaced(false);
      return;
    }
    placeParamsPanel();
    const raf = window.requestAnimationFrame(() => placeParamsPanel());
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".gs__menu--portal, .gs__menu")) return;
      setParamsOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (paramsPanelRef.current?.contains(target)) return;
      if (paramsTriggerRef.current?.contains(target)) return;
      const el = target instanceof Element ? target : null;
      if (
        el?.closest?.(
          ".gs__menu, .gs__menu--portal, [role='listbox'], [data-glass-select-menu]",
        )
      ) {
        return;
      }
      setParamsOpen(false);
    };
    window.addEventListener("resize", placeParamsPanel);
    window.addEventListener("scroll", placeParamsPanel, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", placeParamsPanel);
      window.removeEventListener("scroll", placeParamsPanel, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [paramsOpen, placeParamsPanel]);

  const qualityLabel =
    DESIGN_IMAGE_QUALITY_LABELS[imageOptions.quality] ?? imageOptions.quality;
  const modelLabel =
    DESIGN_IMAGE_MODELS.find((model) => model.id === imageModelId)?.label ??
    imageModelId;
  const generationModeLabel = libraryImageToImage
    ? "图生图"
    : showLibraryCompactReferences
      ? "文生图"
      : imageEditOpen
        ? "图生图"
        : "文生图";
  const generationSummaryText = `${generationModeLabel} · ${qualityLabel} · ${imageOptions.aspectRatio} · ${imageOptions.count}张 · ${modelLabel}`;

  const handleCopy = useCallback(async () => {
    setCopyNote("");
    setError("");
    if (!promptText.trim()) {
      reportStatus("提示词为空，无法复制", "error");
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
      reportStatus("提示词已复制");
    } catch (e) {
      reportStatus(e instanceof Error ? e.message : "复制失败", "error");
    }
  }, [promptText, reportStatus]);

  const handleDownload = async () => {
    if (!currentMediaId) {
      setError("暂无可下载图片");
      return;
    }
    setError("");
    try {
      const url = getProjectAssetImageUrl(projectId, currentMediaId, {
        revision: currentMediaId,
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

  const applyJobResultToUi = useCallback(
    (job: NonNullable<typeof imageJob.job>, activePrompt: string) => {
      if (!job.primaryMediaId || job.mediaIds.length === 0) return;
      const now = new Date().toISOString();
      const media = appendGeneratedMediaGenerations(
        item.generatedMedia,
        job.mediaIds.map((mediaId) => ({
          mediaId,
          prompt: activePrompt || job.params.prompt,
          generatedAt: now,
          promptFingerprint: "",
          mimeType: job.mimeType ?? "image/png",
        })),
      );
      setPickedMediaId(job.primaryMediaId);
      setSyncedMediaCurrentId(job.primaryMediaId);
      setLocalHistoryIds((prev) =>
        mergeMediaIdLists(prev, media.historyIds, job.mediaIds),
      );
      setShowImageHistory(true);
      setVideoRefSafety(media.videoRefSafety ?? null);
      if (imageEditOpen || job.params.mode === "image_to_image") {
        setReferenceSlots((prev) => {
          const kept = prev.slice(1);
          return compactReferenceSlots([
            {
              source: "generated",
              mediaId: job.primaryMediaId!,
              previewUrl: getProjectAssetImageUrl(
                projectId,
                job.primaryMediaId!,
                { revision: job.primaryMediaId! },
              ),
            },
            ...kept,
          ]);
        });
      }
      const history = pushLocalPromptHistory(promptHistory, {
        text: activePrompt || promptText,
        generatedAt: now,
        generationId: item.designPrompt?.generationId ?? null,
        source: "generate_asset",
      });
      setPromptHistory(history);
      setSyncedPromptHistoryLen(history.length);
      if (job.params.mode !== "image_to_image") {
        onPromptUpdated(item.id, activePrompt || job.params.prompt, {
          history,
        });
      } else {
        onPromptUpdated(item.id, promptText, { history });
      }
      reportProgress({
        stage: "saving",
        percent: 88,
        message: "正在保存图片",
      });
      onAssetGenerated(item.id, media);
      if (libraryGenerateTarget) {
        void imageJob.markSaved();
      }
      setError("");
      lastStatusRef.current = null;
      setNotice(
        job.status === "save_failed"
          ? "图片已生成，但写回设计稿失败，可重新保存。"
          : `已生成 ${job.mediaIds.length} 张 · ${DESIGN_IMAGE_QUALITY_LABELS[imageOptions.quality]} · ${imageOptions.aspectRatio}`,
      );
      reportProgress({
        stage: "completed",
        percent: 100,
        message: "图片生成完成",
      });
      scheduleProgressClear(900);
    },
    [
      imageEditOpen,
      imageOptions.aspectRatio,
      imageOptions.quality,
      item.designPrompt?.generationId,
      item.generatedMedia,
      item.id,
      libraryGenerateTarget,
      imageJob,
      onAssetGenerated,
      onPromptUpdated,
      projectId,
      promptHistory,
      promptText,
      reportProgress,
      scheduleProgressClear,
    ],
  );

  useEffect(() => {
    const job = imageJob.job;
    if (!job) return;
    if (job.status === "failed") {
      setGeneratingAsset(false);
      onGeneratingAssetChange?.(item.id, false);
      if (job.errorMessage) setError(job.errorMessage);
      reportProgress({
        stage: "failed",
        percent: 0,
        message: job.errorMessage ?? "资产生成失败",
      });
      scheduleProgressClear(2200);
      return;
    }
    if (job.status !== "succeeded" && job.status !== "save_failed") return;
    if (!job.primaryMediaId) return;
    if (appliedJobResultRef.current === job.id) return;
    // Look-editor jobs share the same character assetId. Never promote them
    // into the main-image panel / 主形象历史 — LibraryCharacterLookEditor owns linking.
    if (job.sourceEntry === "library_look") {
      appliedJobResultRef.current = job.id;
      setGeneratingAsset(false);
      onGeneratingAssetChange?.(item.id, false);
      return;
    }
    // Remount / refreshLatest after we already linked this media — mark applied
    // without re-running onAssetGenerated (avoids preview/scroll thrash).
    if (
      item.generatedMedia?.currentId === job.primaryMediaId ||
      item.generatedMedia?.historyIds?.includes(job.primaryMediaId)
    ) {
      appliedJobResultRef.current = job.id;
      setGeneratingAsset(false);
      onGeneratingAssetChange?.(item.id, false);
      return;
    }
    appliedJobResultRef.current = job.id;
    setGeneratingAsset(false);
    onGeneratingAssetChange?.(item.id, false);
    applyJobResultToUi(job, job.params.prompt);
  }, [
    applyJobResultToUi,
    imageJob.job,
    item.id,
    onGeneratingAssetChange,
    reportProgress,
    scheduleProgressClear,
  ]);

  const handleGenerate = useCallback(async (opts?: {
    multiAngleMode?: DesignMultiAngleMode;
  }) => {
    if (generateBusy || generateInFlightRef.current) return;
    if (imageJob.canRetry && !opts?.multiAngleMode) {
      generateInFlightRef.current = true;
      setGeneratingAsset(true);
      onGeneratingAssetChange?.(item.id, true);
      setError("");
      lastStatusRef.current = null;
      setNotice("");
      const result = await imageJob.retryFromServer();
      generateInFlightRef.current = false;
      if (!result.ok) {
        setError(result.error);
        setGeneratingAsset(false);
        onGeneratingAssetChange?.(item.id, false);
      } else {
        setNotice("已按原参数重新提交生成。");
        reportProgress({ stage: "generating", percent: 20 });
      }
      return;
    }
    const multiAngleMode = opts?.multiAngleMode;
    const isMultiAngle = Boolean(multiAngleMode);
    const activePrompt = imageEditOpen || isMultiAngle
      ? imageEditPrompt.trim()
      : promptText.trim();
    if (!isMultiAngle && !activePrompt) {
      const appearanceIdle =
        hideImageEdit && item.designPrompt?.status === "idle";
      setError(
        imageEditOpen
          ? "请填写二次编辑要求"
          : appearanceIdle
            ? "请填写造型提示词"
            : "提示词为空，无法生成",
      );
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
    if (imageJob.generationBlocked) {
      setError("该素材正在生成中，请等待完成后再试。");
      return;
    }
    generateInFlightRef.current = true;
    setGeneratingAsset(true);
    onGeneratingAssetChange?.(item.id, true);
    setError("");
    lastStatusRef.current = null;
    setNotice("");
    if (progressClearTimerRef.current != null) {
      window.clearTimeout(progressClearTimerRef.current);
      progressClearTimerRef.current = null;
    }
    try {
      reportProgress({
        stage: "validating",
        percent: 8,
        message: "正在校验参考图",
      });
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
      });
      const urls = apiBase(surface, projectId, episodeId, item.id);
      reportProgress({
        stage: "submitted",
        percent: 22,
        message: "已提交生成任务",
      });
      reportProgress({
        stage: "generating",
        percent: 38,
        message: "正在生成图片",
      });

      let res: Response;
      if (libraryGenerateTarget) {
        // Library formal assets are not episode design rows — generate via assets-draft.
        const form = new FormData();
        const hasCompactRefs =
          showLibraryCompactReferences &&
          appendLibraryCompactReferencesToForm(form, libraryReferenceSlots);
        form.set("mode", hasCompactRefs ? "image_to_image" : "text_to_image");
        form.set("assetId", libraryGenerateTarget.assetId);
        form.set("assetKind", libraryGenerateTarget.assetKind);
        form.set("model", imageModelId);
        form.set("prompt", activePrompt);
        form.set("idempotencyKey", safeRandomUUID());
        form.set("quality", imageOptions.quality);
        form.set("aspectRatio", imageOptions.aspectRatio);
        form.set("count", String(imageOptions.count));
        form.set("setPrimary", "false");
        form.set("sourceEntry", "library_image");
        res = await fetch(`${urls.projectRoot}/assets-draft/media/generate`, {
          method: "POST",
          body: form,
        });
      } else if (imageEditOpen || isMultiAngle) {
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
      const payload = await parseResponseJson<{
        error?: string;
        code?: string;
        notice?: string;
        async?: boolean;
        jobId?: string;
        job?: Parameters<typeof imageJob.beginFromGenerateResponse>[0]["job"];
      }>(res, { allowEmpty: res.status === 202 });
      if (!payload) {
        if (res.status === 202 || res.ok) {
          setNotice("已提交生成任务，预计进度见预览区。");
          void imageJob.refreshLatest();
          return;
        }
        throw new Error("服务器没有返回有效数据，请稍后重试。");
      }
      if (!res.ok) {
        if (payload.code === "GENERATION_IN_PROGRESS" && (payload.jobId || payload.job)) {
          imageJob.beginFromGenerateResponse(payload);
        }
        throw new Error(
          payload.error ??
            (res.status >= 500
              ? "生成服务暂时不可用，请稍后再试"
              : "资产生成失败"),
        );
      }
      if (!payload.async || !(payload.jobId || payload.job)) {
        throw new Error("生成接口未返回异步任务，请刷新后重试");
      }
      appliedJobResultRef.current = null;
      imageJob.beginFromGenerateResponse(payload);
      reportProgress({
        stage: "generating",
        percent: 45,
        message: "正在生成图片",
      });
      setNotice(payload.notice ?? "已提交生成任务，预计进度见预览区。");
      if (isMultiAngle) {
        setMultiAngleSelect(MULTI_ANGLE_NONE);
      }
      // Keep generatingAsset true while job is active; effect clears it.
    } catch (e) {
      const message = e instanceof Error ? e.message : "资产生成失败";
      setError(message);
      reportProgress({ stage: "failed", percent: 0, message });
      scheduleProgressClear(2200);
      if (isMultiAngle) {
        setMultiAngleSelect(MULTI_ANGLE_NONE);
      }
      setGeneratingAsset(false);
      onGeneratingAssetChange?.(item.id, false);
    } finally {
      generateInFlightRef.current = false;
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
    imageOptions,
    generateBusy,
    imageJob,
    libraryGenerateTarget,
    libraryReferenceSlots,
    showLibraryCompactReferences,
    onGeneratingAssetChange,
    reportProgress,
    scheduleProgressClear,
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
    lastStatusRef.current = null;
    try {
      const urls = apiBase(surface, projectId, episodeId, item.id);
      const res = await fetch(urls.videoRefPrecheck, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: currentMediaId }),
      });
      const payload = await parseResponseJson<{
        error?: string;
        notice?: string;
        videoRefSafety?: VideoRefSafety;
        generatedMedia?: GeneratedMediaState;
      }>(res);
      if (!res.ok || !payload) {
        throw new Error(payload?.error ?? "人物校验失败");
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
    : libraryImageToImage
      ? `图生图 · ${DESIGN_IMAGE_QUALITY_LABELS[imageOptions.quality]} · ${imageOptions.aspectRatio} · ${imageOptions.count}张`
      : showLibraryCompactReferences
        ? `文生图 · ${DESIGN_IMAGE_QUALITY_LABELS[imageOptions.quality]} · ${imageOptions.aspectRatio} · ${imageOptions.count}张 · ${styleBrief}`
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
          ? "ead-preview-frame ead-preview-frame--zoomable aie-preview-stage"
          : "ead-preview-frame aie-preview-stage"
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
      {generateBusy && generationProgress ? (
        <DesignGenerationOverlay progress={generationProgress} />
      ) : null}
    </div>
  );

  const imageOptionsBlock = !audioDisabled ? (
    <div
      className="ead-generation-options prompt-params-grid"
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
    <MediaHistoryStrip
      forceShow
      testId="design-image-history"
      className="ead-design-image-history"
      items={[...imageHistoryIds].reverse().map((id) => ({
        id,
        thumbUrl: getProjectAssetImageUrl(projectId, id, { revision: id }),
        title: id,
      }))}
      activeId={currentMediaId}
      disabled={generateBusy}
      onSelect={(id) => {
        setPickedMediaId(id);
        const fromHistory =
          item.generatedMedia?.history?.find((h) => h.mediaId === id)
            ?.videoRefSafety ?? null;
        setVideoRefSafety(fromHistory);
        if (item.assetType === "character" && onItemPatched) {
          onItemPatched(item.id, withDesignCurrentMediaAndVoiceMirror(item, id));
        }
      }}
    />
  ) : null;

  return (
    <>
      <div
        className={isEmbedded ? "ead-prompt-embedded" : "ead-modal-backdrop"}
        role={isEmbedded ? undefined : "presentation"}
        onClick={isEmbedded ? undefined : onClose}
        data-testid={isEmbedded ? "design-asset-prompt-panel" : "design-asset-modal"}
        aria-label={isEmbedded ? `素材提示词 · ${item.name}` : undefined}
      >
        <div
          className={
            isEmbedded
              ? "ead-prompt-embedded__stage"
              : `ead-modal-stage${imageEditOpen ? " is-image-editing" : ""}`
          }
          data-testid={isEmbedded ? "design-prompt-stage" : "design-modal-stage"}
          onClick={isEmbedded ? undefined : (e) => e.stopPropagation()}
        >
        <div
          className={isEmbedded ? "ead-prompt-embedded__panel" : "ead-modal ead-modal--wide"}
          role={isEmbedded ? undefined : "dialog"}
          aria-modal={isEmbedded ? undefined : "true"}
          aria-labelledby={isEmbedded ? undefined : titleId}
        >
          {isEmbedded ? null : (
          <header className="ead-modal__head">
            <h2 id={titleId}>设计素材 · {item.name}</h2>
            <button type="button" className="amw-btn" onClick={onClose}>
              关闭
            </button>
          </header>
          )}
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

          <div className={`ead-modal__grid${isEmbedded ? " ead-modal__grid--embedded" : ""}`}>
                        <div className="ead-modal__col">
              {compactGenerationChrome ? (
                <section
                  className={`prompt-panel${
                    showLibraryCompactReferences ? " prompt-panel--with-refs" : ""
                  }`}
                  data-testid="prompt-panel"
                >
                  {showLibraryCompactReferences ? (
                    <CompactPromptReferenceSlots
                      projectId={projectId}
                      slots={libraryReferenceSlots}
                      onSlotsChange={setLibraryReferenceSlots}
                      disabled={generateBusy}
                      onError={setError}
                    />
                  ) : null}
                  <header className="prompt-panel__header">
                    <span
                      className="ead-prompt-context"
                      data-testid="design-prompt-context"
                    >
                      {promptContextLabel || "素材提示词"}
                    </span>
                    <button
                      type="button"
                      className="amw-btn prompt-panel__copy"
                      data-testid="design-copy"
                      title="复制提示词"
                      aria-label="复制提示词"
                      disabled={!promptText.trim() || promptBusy || generateBusy}
                      onClick={() => void handleCopy()}
                    >
                      复制提示词
                    </button>
                  </header>
                  <div className="prompt-panel__editor">
                    <textarea
                      className="amw-textarea"
                      data-testid="design-prompt-textarea"
                      aria-label={promptContextLabel || "素材提示词"}
                      placeholder={
                        promptBusy
                          ? "正在生成提示词…"
                          : formalPromptMissing
                            ? "尚未生成"
                            : "正式素材提示词"
                      }
                      value={promptText}
                      disabled={promptBusy}
                      onChange={(e) => {
                        setPromptText(e.target.value);
                        setStaleHint(false);
                      }}
                    />
                    {formalPromptMissing && !promptText.trim() && !promptBusy ? (
                      <p
                        className="ead-muted"
                        data-testid="design-prompt-not-generated"
                      >
                        尚未生成
                      </p>
                    ) : null}
                  </div>
                  <footer
                    className="prompt-panel__footer"
                    data-testid="prompt-generation-summary"
                  >
                    <span
                      className="prompt-panel__summary"
                      data-testid="prompt-generation-summary-text"
                    >
                      {generationSummaryText}
                    </span>
                    <div className="prompt-panel__actions">
                      <button
                        type="button"
                        className="amw-btn"
                        data-testid="design-adjust-params"
                        ref={paramsTriggerRef}
                        aria-expanded={paramsOpen}
                        disabled={generateBusy || audioDisabled}
                        onClick={() => {
                          setParamsOpen((open) => {
                            const next = !open;
                            if (next) {
                              const trigger = paramsTriggerRef.current;
                              if (trigger) {
                                const rect = trigger.getBoundingClientRect();
                                const width = Math.min(
                                  420,
                                  window.innerWidth - 24,
                                );
                                let left = rect.right - width;
                                left = Math.max(
                                  12,
                                  Math.min(
                                    left,
                                    window.innerWidth - width - 12,
                                  ),
                                );
                                const panelH = 280;
                                let top = rect.bottom + 8;
                                if (top + panelH > window.innerHeight - 12) {
                                  top = rect.top - panelH - 8;
                                }
                                top = Math.max(
                                  12,
                                  Math.min(
                                    top,
                                    window.innerHeight - panelH - 12,
                                  ),
                                );
                                setParamsPanelStyle({
                                  top: top + "px",
                                  left: left + "px",
                                  width: width + "px",
                                });
                                setParamsPlaced(true);
                              }
                            } else {
                              setParamsPlaced(false);
                            }
                            return next;
                          });
                        }}
                      >
                        <Settings2 className="h-3.5 w-3.5" aria-hidden />
                        调整参数
                      </button>
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
                    </div>
                  </footer>
                </section>
              ) : (
                <>
                  <div className="ead-modal__section-head">
                    {hidePromptSectionLabel ? null : <span>素材提示词</span>}
                  </div>
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
                        data-testid="design-copy-legacy"
                        disabled={
                          !promptText.trim() || promptBusy || generateBusy
                        }
                        onClick={() => void handleCopy()}
                      >
                        一键复制
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="ead-modal__col">
              <div className="ead-modal__section-head">
                <span>{previewTitle}</span>
                {hideMediaToolbar ? null : (
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
                )}
              </div>

              {isEmbedded ? null : previewBlock}

              {compactGenerationChrome ? null : imageOptionsBlock}

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

          {!onStatus && copyNote ? (
            <p className="ead-muted" role="status" data-testid="design-copy-ok">
              {copyNote}
            </p>
          ) : null}
          {!onStatus && notice ? (
            <p
              className="ead-muted"
              role="status"
              data-testid="design-gen-notice"
            >
              {notice}
            </p>
          ) : null}
          {!onStatus && error ? (
            <p
              className="ead-error"
              role="alert"
              data-testid="design-modal-error"
            >
              {error}
            </p>
          ) : null}
          {paramsOpen && compactGenerationChrome
            ? createPortal(
                <div
                  ref={paramsPanelRef}
                  className={`prompt-params-popover parameter-popover${paramsPlaced ? " is-placed" : ""}`}
                  data-testid="design-params-popover"
                  style={paramsPanelStyle}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="prompt-params-popover__title">调整生成参数</div>
                  {imageOptionsBlock}
                </div>,
                document.body,
              )
            : null}
          {compactGenerationChrome ? null : (
          <footer
            className={`ead-modal__foot${hideImageEdit ? " ead-modal__foot--split" : ""}`}
          >
            {hideImageEdit ? (
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                data-testid="design-copy-footer"
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
          )}
        </div>
        {!isEmbedded && !hideImageEdit && imageEditOpen ? (
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
      <ImageGenerationTaskPanel
        projectId={projectId}
        context={surface === "workspace" ? "workspace" : "management"}
        job={imageJob.job}
        hideSucceededPreview={isEmbedded}
        canRetry={imageJob.canRetry}
        busyAction={imageJob.busyAction}
        serviceNotice={imageJob.serviceNotice}
        timeoutDialogOpen={imageJob.timeoutDialogOpen}
        deleteConfirmOpen={imageJob.deleteConfirmOpen}
        retrySnapshotIncomplete={imageJob.retrySnapshotIncomplete}
        needsReferenceReplace={imageJob.needsReferenceReplace}
        onRetry={() => void handleGenerate()}
        onRetrySave={() => {
          void imageJob.retrySave().then((result) => {
            if (!result.ok) setError(result.error);
            else setNotice("已重新写回设计稿。");
          });
        }}
        onRequestDeletePending={() => imageJob.setDeleteConfirmOpen(true)}
        onContinueWait={() => void imageJob.continueWaiting()}
        onDismissTimeout={() => imageJob.setTimeoutDialogOpen(false)}
        onRedetectService={() => void imageJob.redetectService()}
        onReplaceReferences={(files) => {
          void imageJob.replaceReferences(files).then((result) => {
            if (!result.ok) setError(result.error);
            else setNotice("参考图已更新，可点击使用原参数重试。");
          });
        }}
        onConfirmDeletePending={() => void imageJob.confirmDeletePending()}
        onCancelDeletePending={() => imageJob.setDeleteConfirmOpen(false)}
        onOpenEditor={() => {
          setError("旧任务缺少完整参数，请在本弹窗重新配置后生成。");
        }}
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
