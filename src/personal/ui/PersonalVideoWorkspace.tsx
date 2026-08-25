"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ImagePlus,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import {
  PERSONAL_VIDEO_ASPECT_RATIOS,
  PERSONAL_VIDEO_DEFAULT_DURATION,
  PERSONAL_VIDEO_DURATION_MAX,
  PERSONAL_VIDEO_DURATION_MIN,
  type PersonalVideoAspectRatio,
} from "@/personal/video-generation/constants";
import {
  defaultPersonalVideoOutputParams,
  modelChoiceFromProviderModelId,
} from "@/personal/video-generation/personal-video-params";
import type { PersonalVideoHistoryItem } from "@/personal/video-generation/types";
import { isAcceptedImageFile } from "@/personal/accepted-image-file";
import {
  labelForStoryboardVideoModelChoice,
  labelForStoryboardVideoStylePreset,
  STORYBOARD_VIDEO_MODEL_CHOICES,
  STORYBOARD_VIDEO_STYLE_OPTIONS,
  type StoryboardVideoModelChoiceId,
  type StoryboardVideoStylePresetId,
} from "@/projects/storyboard/storyboard-video-model-choices";
import { STORYBOARD_VIDEO_RESOLUTIONS } from "@/projects/storyboard/storyboard-video-params";
import type { VideoResolution } from "@/video-generation/types";
import {
  GlassSelect,
  type GlassSelectOption,
} from "@/shell/glass-select";
import { mapGenerationToUiStatus } from "@/projects/storyboard/shot-video-status";
import {
  clampPersonalVideoDuration,
  createVideoReference,
  downloadPersonalVideo,
  formatPersonalVideoDate,
  isPersonalVideoProcessing,
  mapApiPrecheckToStatus,
  mergeVideoReferenceFiles,
  personalVideoPrecheckNotice,
  personalVideoStatusLabel,
  referencesAllowGenerate,
  referencesNeedPrecheck,
  revokeVideoReferences,
  type PersonalVideoReference,
} from "@/personal/ui/personal-video-utils";
import { PersonalVideoHistoryThumb } from "@/personal/ui/PersonalVideoHistoryThumb";
import "@/personal/ui/personal-hub-controls.css";
import "@/personal/ui/personal-video-workspace.css";

const ASPECT_RATIO_OPTIONS: GlassSelectOption[] = [
  { id: "16:9", label: "16:9 横屏" },
  { id: "9:16", label: "9:16 竖屏" },
];

const MODEL_OPTIONS: GlassSelectOption[] = STORYBOARD_VIDEO_MODEL_CHOICES.map(
  (choice) => ({
    id: choice.id,
    label: choice.label,
  }),
);

const RESOLUTION_OPTIONS: GlassSelectOption[] = STORYBOARD_VIDEO_RESOLUTIONS.map(
  (resolution) => ({
    id: resolution,
    label: resolution,
  }),
);

const STYLE_OPTIONS: GlassSelectOption[] = STORYBOARD_VIDEO_STYLE_OPTIONS.map(
  (option) => ({
    id: option.id || "__default__",
    label: option.label,
  }),
);

function refillEditorFromHistory(
  item: PersonalVideoHistoryItem,
  setters: {
    setPrompt: (value: string) => void;
    setAspectRatio: (value: PersonalVideoAspectRatio) => void;
    setDurationSeconds: (value: number) => void;
    setModelChoice: (value: StoryboardVideoModelChoiceId) => void;
    setResolution: (value: VideoResolution) => void;
    setStylePreset: (value: StoryboardVideoStylePresetId) => void;
  },
) {
  setters.setPrompt(item.prompt);
  setters.setAspectRatio(item.aspectRatio);
  setters.setDurationSeconds(item.durationSeconds);
  setters.setModelChoice(modelChoiceFromProviderModelId(item.modelId));
  setters.setResolution(item.resolution);
  setters.setStylePreset(item.stylePreset ?? "");
}

export function PersonalVideoWorkspace() {
  const defaultParams = defaultPersonalVideoOutputParams();
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<PersonalVideoReference[]>([]);
  const [aspectRatio, setAspectRatio] =
    useState<PersonalVideoAspectRatio>(defaultParams.aspectRatio);
  const [modelChoice, setModelChoice] = useState<StoryboardVideoModelChoiceId>(
    defaultParams.modelChoice,
  );
  const [resolution, setResolution] = useState<VideoResolution>(
    defaultParams.resolution,
  );
  const [stylePreset, setStylePreset] = useState<StoryboardVideoStylePresetId>(
    defaultParams.stylePreset,
  );
  const [durationSeconds, setDurationSeconds] = useState(
    PERSONAL_VIDEO_DEFAULT_DURATION,
  );
  const [durationDraft, setDurationDraft] = useState(
    String(PERSONAL_VIDEO_DEFAULT_DURATION),
  );
  const [durationOpen, setDurationOpen] = useState(false);
  const [history, setHistory] = useState<PersonalVideoHistoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [configLoading, setConfigLoading] = useState(true);
  const [configReady, setConfigReady] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyStripRef = useRef<HTMLDivElement>(null);
  const durationTriggerRef = useRef<HTMLButtonElement>(null);
  const durationPopoverRef = useRef<HTMLDivElement>(null);
  const referencesRef = useRef(references);
  referencesRef.current = references;

  const generationMode =
    references.length > 0 ? "image-to-video" : "text-to-video";

  const selectedItem = useMemo(
    () => history.find((item) => item.id === selectedId) ?? null,
    [history, selectedId],
  );

  const previewItem = useMemo(() => {
    if (selectedItem) return selectedItem;
    return (
      history.find(
        (item) =>
          item.videoUrl &&
          mapGenerationToUiStatus(item.status, false) === "completed",
      ) ?? null
    );
  }, [history, selectedItem]);

  const precheckNotice = useMemo(() => {
    if (references.length === 0) return null;
    const blocked = references.find(
      (ref) =>
        ref.precheckStatus === "likely_real_person" ||
        ref.precheckStatus === "other_risk" ||
        ref.precheckStatus === "check_failed",
    );
    if (blocked) {
      return personalVideoPrecheckNotice(
        blocked.precheckStatus,
        blocked.precheckMessage,
      );
    }
    if (referencesNeedPrecheck(references)) {
      return personalVideoPrecheckNotice("checking");
    }
    return personalVideoPrecheckNotice("ok");
  }, [references]);

  const runPrecheck = useCallback(async (referenceId: string, file: File) => {
    const form = new FormData();
    form.set("image", file);
    try {
      const response = await fetch("/api/personal/video-generations/precheck", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "人物检验失败");
      }
      const payload = (await response.json()) as {
        safety: Parameters<typeof mapApiPrecheckToStatus>[0];
        blocked: boolean;
      };
      const status = mapApiPrecheckToStatus(payload.safety, payload.blocked);
      const message =
        payload.safety.reason ??
        (payload.blocked ? "参考图疑似真人，无法用于视频生成" : undefined);
      setReferences((current) =>
        current.map((ref) =>
          ref.id === referenceId
            ? { ...ref, precheckStatus: status, precheckMessage: message }
            : ref,
        ),
      );
    } catch (precheckError) {
      const message =
        precheckError instanceof Error
          ? precheckError.message
          : "人物检验失败";
      setReferences((current) =>
        current.map((ref) =>
          ref.id === referenceId
            ? {
                ...ref,
                precheckStatus: "check_failed",
                precheckMessage: message,
              }
            : ref,
        ),
      );
    }
  }, []);

  const addReferenceFiles = useCallback(
    (files: FileList | File[]) => {
      const created = mergeVideoReferenceFiles([], Array.from(files));
      if (created.length === 0) return;
      const withChecking = created.map((ref) => ({
        ...ref,
        precheckStatus: "checking" as const,
      }));
      setReferences((current) => [...current, ...withChecking]);
      for (const ref of withChecking) {
        void runPrecheck(ref.id, ref.file);
      }
    },
    [runPrecheck],
  );

  const removeReference = useCallback((referenceId: string) => {
    setReferences((current) => {
      const target = current.find((entry) => entry.id === referenceId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((entry) => entry.id !== referenceId);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const loadHistory = useCallback(async () => {
    const response = await fetch("/api/personal/video-generations", {
      credentials: "include",
    });
    if (!response.ok) throw new Error("加载历史失败");
    const payload = (await response.json()) as {
      videos?: PersonalVideoHistoryItem[];
    };
    setHistory(payload.videos ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadHistory();
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "加载历史失败",
          );
        }
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHistory]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/personal/video-generations/config", {
          credentials: "include",
        });
        const payload = (await response.json().catch(() => null)) as {
          ready?: boolean;
          error?: string;
          paidGate?: { ok: boolean; message?: string };
        } | null;
        if (cancelled) return;
        if (!response.ok || !payload?.ready) {
          setConfigReady(false);
          setConfigError(
            payload?.error ?? "视频生成线路尚未配置，请联系管理员。",
          );
          return;
        }
        if (payload.paidGate && !payload.paidGate.ok) {
          setConfigReady(false);
          setConfigError(
            payload.paidGate.message ?? "视频生成当前不可用。",
          );
          return;
        }
        setConfigReady(true);
        setConfigError(null);
      } catch {
        if (!cancelled) {
          setConfigReady(false);
          setConfigError("无法加载视频生成配置");
        }
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      revokeVideoReferences(referencesRef.current);
    };
  }, []);

  const refreshItem = useCallback(async (itemId: string) => {
    const response = await fetch(
      `/api/personal/video-generations/${encodeURIComponent(itemId)}`,
      { credentials: "include" },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      item: PersonalVideoHistoryItem;
    };
    setHistory((current) =>
      current.map((entry) =>
        entry.id === payload.item.id ? payload.item : entry,
      ),
    );
    return payload.item;
  }, []);

  useEffect(() => {
    const processing = history.filter((item) =>
      isPersonalVideoProcessing(item.status),
    );
    if (processing.length === 0) return;

    const timer = window.setInterval(() => {
      for (const item of processing) {
        void refreshItem(item.id);
      }
    }, 4000);

    return () => window.clearInterval(timer);
  }, [history, refreshItem]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    if (!referencesAllowGenerate(references)) return;

    setGenerating(true);
    setError(null);

    const form = new FormData();
    form.set("prompt", prompt.trim());
    form.set("aspectRatio", aspectRatio);
    form.set("durationSeconds", String(durationSeconds));
    form.set("videoModelChoice", modelChoice);
    form.set("resolution", resolution);
    form.set("stylePreset", stylePreset);
    for (const reference of references) {
      form.append("image", reference.file);
    }

    try {
      const response = await fetch("/api/personal/video-generations", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "视频生成失败");
      }
      const payload = (await response.json()) as {
        item: PersonalVideoHistoryItem;
      };
      setHistory((current) => [payload.item, ...current]);
      setSelectedId(payload.item.id);
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "视频生成失败",
      );
    } finally {
      setGenerating(false);
    }
  }, [
    aspectRatio,
    durationSeconds,
    generating,
    modelChoice,
    prompt,
    references,
    resolution,
    stylePreset,
  ]);

  const requestDelete = useCallback(async (item: PersonalVideoHistoryItem) => {
    if (!window.confirm("确定删除这条视频记录吗？")) return;
    const response = await fetch(
      `/api/personal/video-generations/${encodeURIComponent(item.id)}`,
      {
        method: "DELETE",
        credentials: "include",
      },
    );
    if (!response.ok) {
      setError("删除失败");
      return;
    }
    setHistory((current) => current.filter((entry) => entry.id !== item.id));
    setSelectedId((current) => (current === item.id ? null : current));
  }, []);

  const syncDuration = useCallback((value: number) => {
    const next = clampPersonalVideoDuration(value);
    setDurationSeconds(next);
    setDurationDraft(String(next));
  }, []);

  const [durationPopoverPos, setDurationPopoverPos] = useState<{
    top: number;
    left: number;
    placement: "top" | "bottom";
  } | null>(null);

  const updateDurationPopoverPosition = useCallback(() => {
    const trigger = durationTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popoverHeight = 148;
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const placement =
      spaceBelow < popoverHeight && rect.top > popoverHeight + 12
        ? "top"
        : "bottom";
    setDurationPopoverPos({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 252)),
      top: placement === "bottom" ? rect.bottom + 6 : rect.top - 6,
      placement,
    });
  }, []);

  useLayoutEffect(() => {
    if (!durationOpen) {
      setDurationPopoverPos(null);
      return;
    }
    updateDurationPopoverPosition();
  }, [durationOpen, updateDurationPopoverPosition]);

  useEffect(() => {
    if (!durationOpen) return;
    const onReposition = () => updateDurationPopoverPosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [durationOpen, updateDurationPopoverPosition]);

  useEffect(() => {
    if (!durationOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (durationTriggerRef.current?.contains(target)) return;
      if (durationPopoverRef.current?.contains(target)) return;
      setDurationOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDurationOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [durationOpen]);

  const canGenerate =
    configReady &&
    !configLoading &&
    prompt.trim().length > 0 &&
    !generating &&
    referencesAllowGenerate(references) &&
    !referencesNeedPrecheck(references);

  const scrollHistory = useCallback((direction: "left" | "right") => {
    const strip = historyStripRef.current;
    if (!strip) return;
    const amount = Math.max(strip.clientWidth * 0.75, 220);
    strip.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  }, []);

  return (
    <div
      className="personal-video-workspace personal-video-workspace--enter"
      data-testid="personal-video-workspace"
    >
      <section className="personal-video-editor">
        <div className="personal-video-editor__header">
          <div>
            <p className="personal-video-editor__eyebrow">AI 生视频</p>
            <h1 className="personal-video-editor__title">创作工作台</h1>
          </div>
          <span
            className="personal-video-editor__mode"
            data-mode={generationMode}
          >
            {generationMode === "image-to-video" ? "图生视频" : "文生视频"}
          </span>
        </div>

        {configError ? (
          <p
            className="personal-video-editor__config-error"
            data-testid="personal-video-config-error"
          >
            {configError}
          </p>
        ) : null}

        <div className="personal-video-editor__body">
          <div className="personal-video-editor__column personal-video-editor__column--controls">
            <div
              className={`personal-video-editor__prompt-shell${
                isDragging ? " is-dragging" : ""
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(event) => {
                if (
                  event.currentTarget.contains(event.relatedTarget as Node | null)
                ) {
                  return;
                }
                setIsDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                if (event.dataTransfer.files.length > 0) {
                  addReferenceFiles(event.dataTransfer.files);
                }
              }}
            >
              <textarea
                className="personal-video-editor__prompt"
                data-testid="personal-video-prompt"
                placeholder="描述镜头运动、画面内容与氛围…（支持粘贴图片作为参考）"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onPaste={(event) => {
                  const files = event.clipboardData?.files;
                  if (!files || files.length === 0) return;
                  const imageFiles = Array.from(files).filter(isAcceptedImageFile);
                  if (imageFiles.length === 0) return;
                  event.preventDefault();
                  addReferenceFiles(imageFiles);
                }}
                rows={6}
              />

              <div
                className="personal-video-editor__reference-strip personal-video-editor__references"
                data-testid="personal-video-references"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="sr-only"
                  data-testid="personal-video-reference-input"
                  onChange={(event) => {
                    if (event.target.files?.length) {
                      addReferenceFiles(event.target.files);
                    }
                    event.target.value = "";
                  }}
                />

                <button
                  type="button"
                  className="hub-btn hub-btn--upload"
                  data-testid="personal-video-reference-btn"
                  title="上传参考图"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus size={16} aria-hidden />
                </button>

                {references.map((reference) => (
                  <div
                    key={reference.id}
                    className={`hub-ref-thumb hub-ref-thumb--${reference.precheckStatus}`}
                  >
                    <img src={reference.previewUrl} alt="参考图" />
                    {reference.precheckStatus === "checking" ? (
                      <span className="hub-ref-thumb__badge">
                        <Loader2
                          size={12}
                          className="personal-video-spin"
                          aria-hidden
                        />
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="hub-ref-thumb__remove"
                      aria-label="移除参考图"
                      onClick={() => removeReference(reference.id)}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>

              {precheckNotice ? (
                <p
                  className={`personal-video-editor__precheck${
                    referencesAllowGenerate(references)
                      ? " is-ok"
                      : " is-blocked"
                  }`}
                  data-testid="personal-video-precheck-notice"
                >
                  {precheckNotice}
                </p>
              ) : null}

              <div className="personal-video-editor__toolbar hub-toolbar">
                <div className="hub-toolbar__params">
                  <GlassSelect
                    label="模型"
                    title="模型"
                    hideLabel
                    variant="compact"
                    className="personal-video-editor__select"
                    menuClassName="personal-video-editor__select-menu hub-select-menu"
                    value={modelChoice}
                    options={MODEL_OPTIONS}
                    disabled={generating || !configReady}
                    menuPortal
                    onChange={(value) => {
                      if (
                        STORYBOARD_VIDEO_MODEL_CHOICES.some(
                          (choice) => choice.id === value,
                        )
                      ) {
                        setModelChoice(value as StoryboardVideoModelChoiceId);
                      }
                    }}
                  />

                  <GlassSelect
                    label="画质"
                    title="画质"
                    hideLabel
                    variant="compact"
                    className="personal-video-editor__select"
                    menuClassName="personal-video-editor__select-menu hub-select-menu"
                    value={resolution}
                    options={RESOLUTION_OPTIONS}
                    disabled={generating || !configReady}
                    menuPortal
                    onChange={(value) => {
                      if (
                        value === "480P" ||
                        value === "720P" ||
                        value === "1080P"
                      ) {
                        setResolution(value);
                      }
                    }}
                  />

                  <GlassSelect
                    label="比例"
                    title="比例"
                    hideLabel
                    variant="compact"
                    className="personal-video-editor__select"
                    menuClassName="personal-video-editor__select-menu hub-select-menu"
                    value={aspectRatio}
                    options={ASPECT_RATIO_OPTIONS}
                    disabled={generating || !configReady}
                    menuPortal
                    onChange={(value) =>
                      setAspectRatio(
                        PERSONAL_VIDEO_ASPECT_RATIOS.includes(
                          value as PersonalVideoAspectRatio,
                        )
                          ? (value as PersonalVideoAspectRatio)
                          : "16:9",
                      )
                    }
                  />

                  <GlassSelect
                    label="风格"
                    title="风格"
                    hideLabel
                    variant="compact"
                    className="personal-video-editor__select"
                    menuClassName="personal-video-editor__select-menu hub-select-menu"
                    value={stylePreset || "__default__"}
                    options={STYLE_OPTIONS}
                    disabled={generating || !configReady}
                    menuPortal
                    onChange={(value) => {
                      const next = (
                        value === "__default__" ? "" : value
                      ) as StoryboardVideoStylePresetId;
                      setStylePreset(next);
                    }}
                  />

                  <div className="personal-video-editor__duration">
                    <button
                      ref={durationTriggerRef}
                      type="button"
                      className="hub-btn hub-btn--glass personal-video-editor__duration-trigger"
                      data-testid="personal-video-duration-trigger"
                      disabled={generating || !configReady}
                      onClick={() => setDurationOpen((open) => !open)}
                    >
                      <span>{durationSeconds}s</span>
                      <ChevronDown size={14} aria-hidden />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {error ? (
              <p className="personal-video-editor__error">{error}</p>
            ) : null}
          </div>

          <div className="personal-video-editor__column personal-video-editor__column--preview">
            <div className="personal-video-editor__preview-stage">
              {generating ? (
                <div
                  className="personal-video-editor__preview-skeleton"
                  data-testid="personal-video-preview-skeleton"
                >
                  <div className="personal-video-editor__preview-skeleton-shimmer" />
                  <p>视频生成中…</p>
                </div>
              ) : previewItem?.videoUrl ? (
                <div className="personal-video-editor__preview-player">
                  <video
                    key={previewItem.videoUrl}
                    src={previewItem.videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    poster={previewItem.posterUrl ?? undefined}
                    data-testid="personal-video-preview-player"
                  />
                  <div className="personal-video-editor__preview-actions">
                    <button
                      type="button"
                      className="personal-video-overlay-btn personal-video-overlay-btn--download"
                      aria-label="下载视频"
                      data-testid="personal-video-preview-download"
                      onClick={() => downloadPersonalVideo(previewItem)}
                    >
                      <Download size={14} aria-hidden />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="personal-video-editor__preview-empty">
                  {previewItem &&
                  isPersonalVideoProcessing(previewItem.status) ? (
                    <>
                      <Loader2
                        size={28}
                        className="personal-video-spin"
                        aria-hidden
                      />
                      <p>{personalVideoStatusLabel(previewItem.status)}</p>
                    </>
                  ) : previewItem?.errorMessage ? (
                    <>
                      <p>生成失败</p>
                      <p className="personal-video-editor__preview-error">
                        {previewItem.errorMessage}
                      </p>
                    </>
                  ) : (
                    <p>生成完成后将在此预览，或点击历史视频切换预览</p>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              className="hub-btn hub-btn--primary personal-video-editor__generate"
              data-testid="personal-video-generate"
              disabled={!canGenerate}
              onClick={() => void handleGenerate()}
            >
              {generating ? (
                <>
                  <Loader2
                    size={15}
                    className="personal-video-spin"
                    aria-hidden
                  />
                  生成中…
                </>
              ) : (
                <>
                  <Sparkles size={15} aria-hidden />
                  开始生成
                </>
              )}
            </button>

            {selectedItem ? (
              <div
                className="personal-video-editor__meta"
                data-testid="personal-video-selected-meta"
              >
                <span>
                  已选历史 · {formatPersonalVideoDate(selectedItem.generatedAt)}
                </span>
                <span>
                  {selectedItem.aspectRatio} · {selectedItem.resolution} ·{" "}
                  {selectedItem.durationSeconds}s ·{" "}
                  {labelForStoryboardVideoModelChoice(
                    modelChoiceFromProviderModelId(selectedItem.modelId),
                  )}
                  {selectedItem.stylePreset
                    ? ` · ${labelForStoryboardVideoStylePreset(selectedItem.stylePreset)}`
                    : ""}
                </span>
                <span>{personalVideoStatusLabel(selectedItem.status)}</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="personal-video-history">
        <div className="personal-video-history__header">
          <h2>视频生成历史</h2>
          <p>单行展示，左右切换浏览；点击卡片可预览并回填参数</p>
        </div>

        {loadingHistory ? (
          <p className="personal-video-history__empty">正在加载历史…</p>
        ) : history.length === 0 ? (
          <p className="personal-video-history__empty">暂无视频记录</p>
        ) : (
          <div
            className="personal-video-history__carousel"
            data-testid="personal-video-history-carousel"
          >
            <button
              type="button"
              className="personal-video-history__nav"
              aria-label="向左浏览历史"
              onClick={() => scrollHistory("left")}
            >
              <ChevronLeft size={18} aria-hidden />
            </button>

            <div
              ref={historyStripRef}
              className="personal-video-history__strip"
              data-testid="personal-video-history-strip"
            >
              {history.map((item) => {
                const uiStatus = mapGenerationToUiStatus(item.status, false);
                const ratio =
                  item.aspectRatio === "9:16" ? "9 / 16" : "16 / 9";
                return (
                  <article
                    key={item.id}
                    className={`personal-video-card${
                      selectedId === item.id ? " is-selected" : ""
                    }`}
                    data-testid="personal-video-card"
                    data-aspect={item.aspectRatio}
                  >
                    <button
                      type="button"
                      className="personal-video-card__select"
                      onClick={() => {
                        setSelectedId(item.id);
                        refillEditorFromHistory(item, {
                          setPrompt,
                          setAspectRatio,
                          setDurationSeconds,
                          setModelChoice,
                          setResolution,
                          setStylePreset,
                        });
                        setDurationDraft(String(item.durationSeconds));
                      }}
                    >
                      <div
                        className="personal-video-card__thumb"
                        style={{ aspectRatio: ratio }}
                      >
                        <PersonalVideoHistoryThumb
                          posterUrl={item.posterUrl}
                          videoUrl={item.videoUrl}
                        />
                        <span
                          className={`personal-video-card__status personal-video-card__status--${uiStatus}`}
                        >
                          {personalVideoStatusLabel(item.status)}
                        </span>
                      </div>
                    </button>
                    {item.videoUrl ? (
                      <button
                        type="button"
                        className="personal-video-overlay-btn personal-video-overlay-btn--download personal-video-card__download"
                        aria-label="下载视频"
                        data-testid="personal-video-card-download"
                        onClick={() => downloadPersonalVideo(item)}
                      >
                        <Download size={12} aria-hidden />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="personal-video-card__delete"
                      aria-label="删除视频"
                      onClick={(event) => {
                        event.stopPropagation();
                        void requestDelete(item);
                      }}
                    >
                      ×
                    </button>
                  </article>
                );
              })}
            </div>

            <button
              type="button"
              className="personal-video-history__nav"
              aria-label="向右浏览历史"
              onClick={() => scrollHistory("right")}
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>
        )}
      </section>

      {durationOpen &&
      durationPopoverPos &&
      typeof document !== "undefined"
        ? createPortal(
            <div
              ref={durationPopoverRef}
              className={`personal-video-editor__duration-popover personal-video-editor__duration-popover--portal${
                durationPopoverPos.placement === "top" ? " is-top" : ""
              }`}
              data-testid="personal-video-duration-popover"
              style={{
                position: "fixed",
                left: durationPopoverPos.left,
                top: durationPopoverPos.top,
                zIndex: 12000,
              }}
            >
              <label className="personal-video-editor__duration-label">
                时长 {PERSONAL_VIDEO_DURATION_MIN}–{PERSONAL_VIDEO_DURATION_MAX}{" "}
                秒
                <input
                  type="range"
                  min={PERSONAL_VIDEO_DURATION_MIN}
                  max={PERSONAL_VIDEO_DURATION_MAX}
                  step={1}
                  value={durationSeconds}
                  onChange={(event) =>
                    syncDuration(Number(event.target.value))
                  }
                />
              </label>
              <label className="personal-video-editor__duration-input-wrap">
                <input
                  type="number"
                  min={PERSONAL_VIDEO_DURATION_MIN}
                  max={PERSONAL_VIDEO_DURATION_MAX}
                  value={durationDraft}
                  onChange={(event) => {
                    setDurationDraft(event.target.value);
                    const parsed = Number(event.target.value);
                    if (Number.isFinite(parsed)) {
                      syncDuration(parsed);
                    }
                  }}
                />
                <span>s</span>
              </label>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
