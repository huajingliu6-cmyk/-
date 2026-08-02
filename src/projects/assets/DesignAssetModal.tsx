"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Download, History, ShieldCheck } from "lucide-react";
import type {
  AssetDesignPromptHistoryEntry,
  EpisodeAssetDesignItem,
  GeneratedMediaState,
} from "@/projects/assets/episode-design/types";
import type { AudioAsset, VideoRefSafety, VoiceOption } from "@/projects/assets/types";
import { formatDesignDraftSeedText } from "@/projects/assets/episode-design/format-design-draft-seed";
import {
  designVideoRefSafetyBadge,
  isDesignMediaVideoRefLocked,
} from "@/projects/assets/episode-design/design-media-video-ref-labels";
import {
  getDesignMediaVoiceBinding,
  isMediaVoiceBound,
  withDesignCurrentMediaAndVoiceMirror,
  withDesignMediaVoiceBinding,
} from "@/projects/assets/episode-design/design-media-voice";
import {
  appendPromptHistory,
  mergeMediaIdLists,
} from "@/projects/assets/episode-design/generated-media-history";
import { getProjectAssetImageUrl } from "@/projects/assets/asset-image-url";
import { DesignImageLightbox } from "@/projects/assets/DesignImageLightbox";
import { VoiceSelector } from "@/projects/assets/VoiceSelector";
import { VoicePreviewButton } from "@/projects/assets/VoicePreviewButton";

export type DesignAssetModalProps = {
  open: boolean;
  item: EpisodeAssetDesignItem | null;
  projectId: string;
  episodeId: string;
  /** management | workspace — selects API base path */
  surface: "project_management" | "workspace";
  projectVoices?: VoiceOption[];
  audios?: AudioAsset[];
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
  /** Persist voice / media patches from the modal (per history image). */
  onItemPatched?: (itemId: string, next: EpisodeAssetDesignItem) => void;
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
  projectVoices = [],
  audios = [],
  isGeneratingAsset = false,
  onGeneratingAssetChange,
  onClose,
  onPromptUpdated,
  onAssetGenerated,
  onItemPatched,
}: DesignAssetModalBodyProps) {
  const titleId = useId();
  const seed = initialPromptForItem(item);
  const initialHistory = buildInitialPromptHistory(item, seed);
  const didSeedExtract =
    Boolean(seed.trim()) && !(item.designPrompt?.text?.trim());

  const [promptText, setPromptText] = useState(seed);
  const [promptHistory, setPromptHistory] =
    useState<AssetDesignPromptHistoryEntry[]>(initialHistory);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [generatingAsset, setGeneratingAsset] = useState(false);
  const generateBusy = generatingAsset || isGeneratingAsset;
  const [copyNote, setCopyNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [voiceNote, setVoiceNote] = useState("");
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

  const regeneratePrompt = useCallback(async () => {
    setLoadingPrompt(true);
    setError("");
    setCopyNote("");
    try {
      const urls = apiBase(surface, projectId, episodeId, item.id);
      const res = await fetch(urls.prompt, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: `prompt-${item.id}-${Date.now()}`,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        prompt?: string;
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
      onPromptUpdatedRef.current(item.id, text, {
        history,
        generationId: payload.designPrompt?.generationId ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "提示词生成失败");
    } finally {
      setLoadingPrompt(false);
    }
  }, [item, surface, projectId, episodeId, promptHistory]);

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
    try {
      const urls = apiBase(surface, projectId, episodeId, item.id);
      const res = await fetch(urls.generate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptText,
          idempotencyKey: `asset-${item.id}-${Date.now()}`,
          confirmPaidGeneration: false,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        notice?: string;
        mediaId?: string;
        generatedMedia?: GeneratedMediaState;
        videoRefSafety?: VideoRefSafety;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "资产生成失败");
      }
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
      setNotice(payload.notice ?? "已生成 4K · 16:9 参考图");
      setShowImageHistory(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "资产生成失败");
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
    generateBusy,
    onGeneratingAssetChange,
    onPromptUpdated,
    onAssetGenerated,
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
    : `点击「生成资产」将按 16:9、4K 生成${styleBrief}`;
  const generateTitle = audioDisabled
    ? "当前未配置该类型的音频生成能力"
    : `文生图 · 4K · 16:9 · ${styleBrief}`;
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

  const mediaVoice =
    item.assetType === "character"
      ? getDesignMediaVoiceBinding(item, currentMediaId)
      : null;
  const mediaVoiceBound = mediaVoice ? isMediaVoiceBound(mediaVoice) : false;

  const patchCharacterVoice = (binding: {
    voiceId: string | null;
    voiceName: string | null;
    voiceBound: boolean;
  }) => {
    if (item.assetType !== "character" || !currentMediaId || !onItemPatched) {
      return;
    }
    const next = withDesignMediaVoiceBinding(
      item,
      currentMediaId,
      binding,
    );
    onItemPatched(item.id, next);
  };

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
            </div>

            <div className="ead-modal__col">
              <div className="ead-modal__section-head">
                <span>生成预览 · 4K · 16:9</span>
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
              {item.assetType === "character" && currentMediaId ? (
                <div
                  className="ead-modal__voice-row"
                  data-testid="design-media-voice"
                >
                  <p className="ead-muted ead-modal__voice-hint">
                    当前历史图需单独绑定音色；切换图片后请重新选择并绑定。
                  </p>
                  <div className="ead-card__voice-row">
                    <div className="ead-card__voice-select">
                      <VoiceSelector
                        label="本图音色"
                        value={mediaVoice?.voiceId ?? null}
                        disabled={generateBusy}
                        projectVoices={projectVoices}
                        onChange={(voice) =>
                          patchCharacterVoice({
                            voiceId: voice?.id ?? null,
                            voiceName: voice?.name ?? null,
                            voiceBound: false,
                          })
                        }
                      />
                    </div>
                    <div className="ead-card__voice-actions">
                      <VoicePreviewButton
                        projectId={projectId}
                        voiceId={mediaVoice?.voiceId ?? null}
                        audios={audios}
                        className="amw-btn ead-card__voice-preview"
                        testId="design-media-voice-preview"
                        onStatus={setVoiceNote}
                      />
                      <button
                        type="button"
                        className={`amw-btn ead-card__voice-bind${
                          mediaVoiceBound ? " is-bound" : ""
                        }`}
                        data-testid="design-media-voice-bind"
                        disabled={
                          generateBusy ||
                          !mediaVoice?.voiceId ||
                          mediaVoiceBound
                        }
                        title={
                          mediaVoiceBound
                            ? "本图音色已绑定"
                            : "将当前选择的音色绑定到本张历史图"
                        }
                        onClick={() => {
                          if (!mediaVoice?.voiceId) {
                            setVoiceNote("请先选择音色再绑定");
                            return;
                          }
                          patchCharacterVoice({
                            voiceId: mediaVoice.voiceId,
                            voiceName: mediaVoice.voiceName,
                            voiceBound: true,
                          });
                          setNotice(
                            `已为本图绑定音色${
                              mediaVoice.voiceName
                                ? `：${mediaVoice.voiceName}`
                                : ""
                            }`,
                          );
                        }}
                      >
                        {mediaVoiceBound ? "本图已绑定" : "绑定音色"}
                      </button>
                    </div>
                  </div>
                  {voiceNote ? (
                    <p className="ead-muted ead-card__voice-note">{voiceNote}</p>
                  ) : null}
                </div>
              ) : item.assetType === "character" ? (
                <p className="ead-muted" data-testid="design-media-voice-empty">
                  请先生成图片，再为该历史图绑定音色。
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
                            setVoiceNote("");
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
              className="amw-btn"
              data-testid="design-regenerate-prompt"
              disabled={loadingPrompt || generateBusy}
              onClick={() => void regeneratePrompt()}
            >
              {loadingPrompt ? "生成中…" : "重新生成提示词"}
            </button>
            <button
              type="button"
              className="amw-btn amw-btn-primary"
              data-testid="design-copy"
              disabled={!promptText.trim() || loadingPrompt || generateBusy}
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
    </>
  );
}

export function DesignAssetModal(props: DesignAssetModalProps) {
  if (!props.open || !props.item) return null;
  return (
    <DesignAssetModalBody key={props.item.id} {...props} item={props.item} />
  );
}
