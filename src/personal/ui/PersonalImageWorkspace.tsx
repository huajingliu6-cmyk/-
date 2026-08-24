"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Pencil,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  PERSONAL_IMAGE_HISTORY_PAGE_SIZE,
  PERSONAL_IMAGE_MAX_REFERENCES,
  personalAspectRatioToCss,
} from "@/personal/image-generation/constants";
import {
  DESIGN_IMAGE_ASPECT_RATIOS,
  DESIGN_IMAGE_ASPECT_RATIO_LABELS,
} from "@/projects/assets/episode-design/image-generation-options";
import { DESIGN_IMAGE_MODELS } from "@/projects/assets/episode-design/image-generation-models";
import {
  GlassSelect,
  type GlassSelectOption,
} from "@/shell/glass-select";
import type { PersonalImageHistoryItem } from "@/personal/image-generation/types";
import { isAcceptedImageFile } from "@/personal/accepted-image-file";
import { PersonalImageReferenceStrip } from "@/personal/ui/PersonalImageReferenceStrip";
import {
  downloadPersonalImage,
  mergeReferenceFiles,
  revokeReferenceImages,
  type PersonalReferenceImage,
  defaultPersonalMaterialName,
} from "@/personal/ui/personal-image-utils";
import "@/personal/ui/personal-hub-controls.css";
import "@/personal/ui/personal-image-workspace.css";

const ASPECT_RATIO_OPTIONS: GlassSelectOption[] =
  DESIGN_IMAGE_ASPECT_RATIOS.map((value) => ({
    id: value,
    label: DESIGN_IMAGE_ASPECT_RATIO_LABELS[value],
  }));

const RESOLUTION_OPTIONS: GlassSelectOption[] = [
  { id: "1K", label: "1K" },
  { id: "2K", label: "2K" },
  { id: "4K", label: "4K" },
];

const COUNT_OPTIONS: GlassSelectOption[] = [
  { id: "1", label: "1张" },
  { id: "2", label: "2张" },
  { id: "3", label: "3张" },
];

const MODEL_OPTIONS: GlassSelectOption[] = DESIGN_IMAGE_MODELS.map((model) => ({
  id: model.id,
  label: model.label,
}));

type UploadDialogState = {
  item: PersonalImageHistoryItem;
  name: string;
};

function refillEditorFromItem(
  item: PersonalImageHistoryItem,
  setters: {
    setPrompt: (value: string) => void;
    setAspectRatio: (value: string) => void;
    setResolution: (value: "1K" | "2K" | "4K") => void;
    setModelId: (value: string) => void;
    setCount: (value: 1 | 2 | 3) => void;
  },
) {
  setters.setPrompt(item.prompt);
  setters.setAspectRatio(item.aspectRatio);
  setters.setResolution(item.resolution);
  setters.setModelId(item.modelId);
  setters.setCount(item.count);
}

export function PersonalImageWorkspace() {
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<PersonalReferenceImage[]>([]);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState<"1K" | "2K" | "4K">("1K");
  const [modelId, setModelId] = useState("gpt-image-2");
  const [count, setCount] = useState<1 | 2 | 3>(1);
  const [history, setHistory] = useState<PersonalImageHistoryItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<PersonalImageHistoryItem | null>(
    null,
  );
  const [uploadDialog, setUploadDialog] = useState<UploadDialogState | null>(
    null,
  );
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const historyOffsetRef = useRef(0);
  const referencesRef = useRef(references);
  referencesRef.current = references;

  const generationMode =
    references.length > 0 ? "image-to-image" : "text-to-image";

  const addReferenceFiles = useCallback((files: FileList | File[]) => {
    setReferences((current) =>
      mergeReferenceFiles(
        current,
        Array.from(files),
        PERSONAL_IMAGE_MAX_REFERENCES,
      ),
    );
  }, []);

  const loadHistoryPage = useCallback(async (offset: number, append: boolean) => {
    const response = await fetch(
      `/api/personal/image-generations?limit=${PERSONAL_IMAGE_HISTORY_PAGE_SIZE}&offset=${offset}`,
      { credentials: "include" },
    );
    if (!response.ok) throw new Error("加载历史失败");
    const payload = (await response.json()) as {
      images?: PersonalImageHistoryItem[];
      hasMore?: boolean;
    };
    const images = payload.images ?? [];
    setHistory((current) => (append ? [...current, ...images] : images));
    setHasMore(payload.hasMore === true);
    historyOffsetRef.current = append ? offset + images.length : images.length;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadHistoryPage(0, false);
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
  }, [loadHistoryPage]);

  useEffect(() => {
    return () => {
      revokeReferenceImages(referencesRef.current);
    };
  }, []);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasMore || loadingMore || loadingHistory) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingMore) return;
        setLoadingMore(true);
        void loadHistoryPage(historyOffsetRef.current, true)
          .catch((loadError) => {
            setError(
              loadError instanceof Error ? loadError.message : "加载更多失败",
            );
          })
          .finally(() => setLoadingMore(false));
      },
      { rootMargin: "240px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadHistoryPage, loadingHistory, loadingMore]);

  const removeReference = useCallback((referenceId: string) => {
    setReferences((current) => {
      const target = current.find((entry) => entry.id === referenceId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((entry) => entry.id !== referenceId);
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || generating) return;

    setGenerating(true);
    setError(null);

    const form = new FormData();
    form.set("prompt", prompt.trim());
    form.set("aspectRatio", aspectRatio);
    form.set("resolution", resolution);
    form.set("model", modelId);
    form.set("count", String(count));

    for (const reference of references) {
      form.append("image", reference.file);
    }

    try {
      const response = await fetch("/api/personal/image-generations", {
        method: "POST",
        body: form,
        credentials: "include",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "图片生成失败");
      }

      const payload = (await response.json()) as {
        images: PersonalImageHistoryItem[];
      };

      setHistory((current) => [...payload.images, ...current]);
      historyOffsetRef.current += payload.images.length;
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "图片生成失败",
      );
    } finally {
      setGenerating(false);
    }
  }, [
    aspectRatio,
    count,
    generating,
    modelId,
    prompt,
    references,
    resolution,
  ]);

  const requestDelete = useCallback(async (itemId: string) => {
    if (!window.confirm("确定删除这张图片吗？已入库的个人素材副本不会受影响。")) {
      return;
    }

    const response = await fetch(
      `/api/personal/image-generations/${encodeURIComponent(itemId)}`,
      {
        method: "DELETE",
        credentials: "include",
      },
    );
    if (!response.ok) {
      setError("删除失败");
      return;
    }
    setHistory((current) => current.filter((item) => item.id !== itemId));
    setPreviewItem((current) => (current?.id === itemId ? null : current));
    historyOffsetRef.current = Math.max(0, historyOffsetRef.current - 1);
  }, []);

  const uploadToPersonalAssets = useCallback(
    async (item: PersonalImageHistoryItem, name?: string) => {
      if (item.uploadedToPersonalAssets || uploadingId) return;
      setUploadingId(item.id);
      setError(null);
      try {
        const response = await fetch(
          `/api/personal/image-generations/${encodeURIComponent(item.id)}/upload`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name?.trim() || undefined,
            }),
          },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error ?? "上传失败");
        }
        const payload = (await response.json()) as {
          item: PersonalImageHistoryItem;
        };
        setHistory((current) =>
          current.map((entry) =>
            entry.id === item.id ? payload.item : entry,
          ),
        );
        setUploadDialog(null);
      } catch (uploadError) {
        setError(
          uploadError instanceof Error ? uploadError.message : "上传失败",
        );
      } finally {
        setUploadingId(null);
      }
    },
    [uploadingId],
  );

  const openUploadDialog = useCallback((item: PersonalImageHistoryItem) => {
    if (item.uploadedToPersonalAssets) return;
    setUploadDialog({
      item,
      name: item.name || defaultPersonalMaterialName(item.prompt),
    });
  }, []);

  const saveImageName = useCallback(
    async (item: PersonalImageHistoryItem, nextName: string) => {
      const trimmed = nextName.trim();
      if (!trimmed || trimmed === item.name) return;

      try {
        const response = await fetch(
          `/api/personal/image-generations/${encodeURIComponent(item.id)}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: trimmed }),
          },
        );
        if (!response.ok) {
          throw new Error("名称保存失败");
        }
        const payload = (await response.json()) as {
          item: PersonalImageHistoryItem;
        };
        setHistory((current) =>
          current.map((entry) =>
            entry.id === item.id ? payload.item : entry,
          ),
        );
      } catch (saveError) {
        setError(
          saveError instanceof Error ? saveError.message : "名称保存失败",
        );
      }
    },
    [],
  );

  const previewIndex = useMemo(() => {
    if (!previewItem) return -1;
    return history.findIndex((item) => item.id === previewItem.id);
  }, [history, previewItem]);

  const openPreview = useCallback((item: PersonalImageHistoryItem) => {
    setPreviewItem(item);
  }, []);

  const shiftPreview = useCallback(
    (direction: -1 | 1) => {
      if (previewIndex < 0 || history.length === 0) return;
      const nextIndex = previewIndex + direction;
      if (nextIndex < 0 || nextIndex >= history.length) return;
      setPreviewItem(history[nextIndex] ?? null);
    },
    [history, previewIndex],
  );


  const skeletonCount = generating ? count : 0;

  return (
    <div className="personal-image-workspace personal-image-workspace--enter">
      <section className="personal-image-editor">
        <div className="personal-image-editor__header">
          <div>
            <p className="personal-image-editor__eyebrow">AI 生图</p>
            <h1 className="personal-image-editor__title">创作工作台</h1>
          </div>
          <span className="personal-image-editor__mode" data-mode={generationMode}>
            {generationMode === "image-to-image" ? "图生图" : "文生图"}
          </span>
        </div>

        <div className="personal-image-editor__body">
          <div className="personal-image-editor__main">
            <div
              className={`personal-image-editor__prompt-shell${
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
                id="personal-image-prompt"
                className="personal-image-editor__prompt"
                data-testid="personal-image-prompt"
                placeholder="描述你想生成的画面、风格、构图与光线…（支持粘贴图片作为参考）"
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
                rows={7}
              />

              <PersonalImageReferenceStrip
                references={references}
                onAddFiles={addReferenceFiles}
                onRemove={removeReference}
              />

              <div className="personal-image-editor__toolbar hub-toolbar">
                <div className="hub-toolbar__params">
                  <GlassSelect
                    label="比例"
                    title="比例"
                    hideLabel
                    variant="compact"
                    className="personal-image-editor__select"
                    menuClassName="personal-image-editor__select-menu hub-select-menu"
                    value={aspectRatio}
                    options={ASPECT_RATIO_OPTIONS}
                    menuPortal
                    onChange={setAspectRatio}
                  />
                  <GlassSelect
                    label="画质"
                    title="画质"
                    hideLabel
                    variant="compact"
                    className="personal-image-editor__select"
                    menuClassName="personal-image-editor__select-menu hub-select-menu"
                    value={resolution}
                    options={RESOLUTION_OPTIONS}
                    menuPortal
                    onChange={(value) =>
                      setResolution(value as "1K" | "2K" | "4K")
                    }
                  />
                  <GlassSelect
                    label="模型"
                    title="模型"
                    hideLabel
                    variant="compact"
                    className="personal-image-editor__select personal-image-editor__select--model"
                    menuClassName="personal-image-editor__select-menu hub-select-menu"
                    value={modelId}
                    options={MODEL_OPTIONS}
                    menuPortal
                    onChange={setModelId}
                  />
                  <GlassSelect
                    label="张数"
                    title="张数"
                    hideLabel
                    variant="compact"
                    className="personal-image-editor__select"
                    menuClassName="personal-image-editor__select-menu hub-select-menu"
                    value={String(count)}
                    options={COUNT_OPTIONS}
                    menuPortal
                    onChange={(value) => {
                      const next = Number(value);
                      if (next === 2 || next === 3) setCount(next);
                      else setCount(1);
                    }}
                  />
                </div>

                <button
                  type="button"
                  className="hub-btn hub-btn--primary hub-toolbar__primary personal-image-editor__generate"
                  data-testid="personal-image-generate"
                  disabled={!prompt.trim() || generating}
                  onClick={() => void handleGenerate()}
                >
                  {generating ? (
                    <>
                      <Loader2 size={15} className="personal-image-spin" aria-hidden />
                      生成中…
                    </>
                  ) : (
                    <>
                      <Sparkles size={15} aria-hidden />
                      开始生成
                    </>
                  )}
                </button>
              </div>
            </div>

            {error ? <p className="personal-image-editor__error">{error}</p> : null}
          </div>
        </div>
      </section>

      <section className="personal-image-history">
        <div className="personal-image-history__header">
          <h2>个人生图历史</h2>
          <p>首屏加载 {PERSONAL_IMAGE_HISTORY_PAGE_SIZE} 张，向下滚动加载更多</p>
        </div>

        {loadingHistory ? (
          <p className="personal-image-history__empty">正在加载历史…</p>
        ) : history.length === 0 && skeletonCount === 0 ? (
          <p className="personal-image-history__empty">
            还没有生成记录，先写一条提示词试试。
          </p>
        ) : (
          <div
            className="personal-image-history__masonry"
            data-testid="personal-image-history-masonry"
          >
            {Array.from({ length: skeletonCount }).map((_, index) => (
              <div
                key={`skeleton-${index}`}
                className="personal-image-card personal-image-card--skeleton"
                data-testid="personal-image-skeleton"
              >
                <div
                  className="personal-image-card__visual"
                  style={{ aspectRatio: personalAspectRatioToCss(aspectRatio) }}
                >
                  <div className="personal-image-card__skeleton-shimmer" />
                </div>
              </div>
            ))}

            {history.map((item) => (
              <article
                key={item.id}
                className="personal-image-card"
                data-testid="personal-image-card"
              >
                <div
                  className="personal-image-card__visual"
                  style={{ aspectRatio: personalAspectRatioToCss(item.aspectRatio) }}
                >
                  <div
                    className="personal-image-card__blur-bg"
                    style={{ backgroundImage: `url(${item.imageUrl})` }}
                  />
                  <button
                    type="button"
                    className="personal-image-card__image-btn"
                    data-image-center
                    onClick={() => openPreview(item)}
                  >
                    <img
                      src={item.imageUrl}
                      alt={item.prompt}
                      className="personal-image-card__image"
                    />
                  </button>

                  <div className="personal-image-card__top-actions">
                    <button
                      type="button"
                      className="personal-image-card__icon-btn personal-image-card__icon-btn--download"
                      aria-label="下载图片"
                      onClick={() => downloadPersonalImage(item)}
                    >
                      <Download size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="personal-image-card__icon-btn personal-image-card__icon-btn--delete"
                      aria-label="删除图片"
                      onClick={() => void requestDelete(item.id)}
                    >
                      ×
                    </button>
                  </div>

                  <div className="personal-image-card__bottom-actions">
                    <button
                      type="button"
                      className="hub-btn hub-btn--glass hub-btn--overlay"
                      data-testid="personal-image-edit-prompt"
                      onClick={() =>
                        refillEditorFromItem(item, {
                          setPrompt,
                          setAspectRatio,
                          setResolution,
                          setModelId,
                          setCount,
                        })
                      }
                    >
                      <Pencil size={12} aria-hidden />
                      编辑提示词
                    </button>
                    <button
                      type="button"
                      className="hub-btn hub-btn--glass hub-btn--overlay"
                      disabled={
                        item.uploadedToPersonalAssets || uploadingId === item.id
                      }
                      onClick={() => {
                        if (item.uploadedToPersonalAssets) return;
                        openUploadDialog(item);
                      }}
                    >
                      {uploadingId === item.id ? (
                        <>
                          <Loader2
                            size={12}
                            className="personal-image-spin"
                            aria-hidden
                          />
                          上传中…
                        </>
                      ) : item.uploadedToPersonalAssets ? (
                        "已上传至个人素材"
                      ) : (
                        <>
                          <Upload size={12} aria-hidden />
                          上传至个人素材
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="personal-image-card__footer">
                  <input
                    type="text"
                    className="personal-image-card__name"
                    data-testid="personal-image-card-name"
                    defaultValue={item.name}
                    maxLength={80}
                    aria-label="图片名称"
                    onBlur={(event) =>
                      void saveImageName(item, event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
              </article>
            ))}
          </div>
        )}

        {hasMore ? (
          <div
            ref={loadMoreRef}
            className="personal-image-history__load-more"
            data-testid="personal-image-load-more"
          >
            {loadingMore ? "正在加载更多…" : "继续向下滚动加载更多"}
          </div>
        ) : null}
      </section>

      {previewItem ? (
        <div
          className="personal-image-preview"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setPreviewItem(null)}
        >
          <div className="personal-image-preview__toolbar">
            <button
              type="button"
              className="personal-image-preview__toolbar-btn"
              aria-label="下载图片"
              onClick={(event) => {
                event.stopPropagation();
                downloadPersonalImage(previewItem);
              }}
            >
              <Download size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="personal-image-preview__toolbar-btn"
              aria-label="关闭预览"
              onClick={(event) => {
                event.stopPropagation();
                setPreviewItem(null);
              }}
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          {previewIndex > 0 ? (
            <button
              type="button"
              className="personal-image-preview__nav personal-image-preview__nav--prev"
              aria-label="上一张"
              onClick={(event) => {
                event.stopPropagation();
                shiftPreview(-1);
              }}
            >
              <ChevronLeft size={22} aria-hidden />
            </button>
          ) : null}

          {previewIndex >= 0 && previewIndex < history.length - 1 ? (
            <button
              type="button"
              className="personal-image-preview__nav personal-image-preview__nav--next"
              aria-label="下一张"
              onClick={(event) => {
                event.stopPropagation();
                shiftPreview(1);
              }}
            >
              <ChevronRight size={22} aria-hidden />
            </button>
          ) : null}

          <div
            className="personal-image-preview__stage"
            onClick={(event) => event.stopPropagation()}
          >
            <img src={previewItem.imageUrl} alt={previewItem.prompt} />
          </div>
        </div>
      ) : null}

      {uploadDialog ? (
        <div
          className="personal-image-upload-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="上传至个人素材"
          onClick={() => setUploadDialog(null)}
        >
          <div
            className="personal-image-upload-dialog__panel"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>上传至个人素材</h3>
            <p>为素材命名后入库，历史记录仍会保留。</p>
            <label className="personal-image-upload-dialog__label">
              素材名称
              <input
                type="text"
                value={uploadDialog.name}
                maxLength={80}
                onChange={(event) =>
                  setUploadDialog((current) =>
                    current
                      ? { ...current, name: event.target.value }
                      : current,
                  )
                }
              />
            </label>
            <div className="personal-image-upload-dialog__actions">
              <button
                type="button"
                className="hub-btn hub-btn--glass personal-image-upload-dialog__btn"
                onClick={() => setUploadDialog(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="hub-btn hub-btn--glass personal-image-upload-dialog__btn"
                disabled={uploadingId === uploadDialog.item.id}
                onClick={() =>
                  void uploadToPersonalAssets(uploadDialog.item)
                }
              >
                直接入库
              </button>
              <button
                type="button"
                className="hub-btn hub-btn--primary personal-image-upload-dialog__btn"
                disabled={uploadingId === uploadDialog.item.id}
                onClick={() =>
                  void uploadToPersonalAssets(
                    uploadDialog.item,
                    uploadDialog.name,
                  )
                }
              >
                保存并入库
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
