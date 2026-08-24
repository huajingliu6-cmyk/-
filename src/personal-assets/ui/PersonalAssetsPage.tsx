"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  PERSONAL_ASSET_CATEGORY_OPTIONS,
  PERSONAL_ASSET_DEFAULT_CATEGORY,
  PERSONAL_ASSET_DRAG_CONFIRM_KEY,
  PERSONAL_ASSET_SORT_OPTIONS,
  formatPersonalAssetBytes,
} from "@/personal-assets/constants";
import type {
  PersonalAsset,
  PersonalAssetCategory,
  PersonalAssetSort,
} from "@/personal-assets/types";
import {
  assetDownloadUrl,
  assetImageUrl,
  categoryLabel,
  clampPopoverPosition,
  defaultAssetName,
  downloadAssetFile,
  formatAssetDate,
  formatUsage,
  isImageFile,
  sourceTypeLabel,
  usagePercent,
  type UploadQueueItem,
} from "@/personal-assets/ui/personal-assets-utils";
import "@/personal/ui/personal-hub-controls.css";
import "@/personal-assets/ui/personal-assets-page.css";

type ListState = {
  items: PersonalAsset[];
  nextCursor: string | null;
  total: number;
  categoryCounts: Record<PersonalAssetCategory, number>;
  usedBytes: number;
  quotaBytes: number;
};

type ContextMenuState = {
  asset: PersonalAsset;
  x: number;
  y: number;
  showCategoryMenu: boolean;
};

type DetailsState = {
  asset: PersonalAsset;
  x: number;
  y: number;
};

const EMPTY_COUNTS: Record<PersonalAssetCategory, number> = {
  character: 0,
  scene: 0,
  prop: 0,
  other: 0,
};

function createQueueItem(file: File): UploadQueueItem {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
    file,
    previewUrl: URL.createObjectURL(file),
    name: defaultAssetName(file),
    category: PERSONAL_ASSET_DEFAULT_CATEGORY,
    status: "pending",
  };
}

export function PersonalAssetsPage() {
  const [category, setCategory] = useState<PersonalAssetCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [sort, setSort] = useState<PersonalAssetSort>("recent");
  const [list, setList] = useState<ListState>({
    items: [],
    nextCursor: null,
    total: 0,
    categoryCounts: EMPTY_COUNTS,
    usedBytes: 0,
    quotaBytes: 1024 * 1024 * 1024,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [detailsCard, setDetailsCard] = useState<DetailsState | null>(null);
  const [renameTarget, setRenameTarget] = useState<PersonalAsset | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [uploadCategory, setUploadCategory] = useState<PersonalAssetCategory>(
    PERSONAL_ASSET_DEFAULT_CATEGORY,
  );
  const [uploading, setUploading] = useState(false);
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [queueSummary, setQueueSummary] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [dragConfirmCount, setDragConfirmCount] = useState(0);
  const [pendingDragFiles, setPendingDragFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const previewTouchRef = useRef<{
    startX: number;
    startY: number;
    scale: number;
    translateX: number;
    translateY: number;
    pinching: boolean;
  } | null>(null);
  const [previewTransform, setPreviewTransform] = useState({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  const visibleItems = useMemo(() => {
    if (!showSelectedOnly) return list.items;
    return list.items.filter((item) => selectedIds.has(item.id));
  }, [list.items, selectedIds, showSelectedOnly]);

  const previewIndex = useMemo(
    () => visibleItems.findIndex((item) => item.id === previewId),
    [previewId, visibleItems],
  );
  const previewItem =
    previewIndex >= 0 ? visibleItems[previewIndex] ?? null : null;

  const usagePct = usagePercent(list.usedBytes, list.quotaBytes);

  const fetchList = useCallback(
    async (input?: { append?: boolean; cursor?: string | null }) => {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (search.trim()) params.set("search", search.trim());
      params.set("sort", sort);
      if (input?.cursor) params.set("cursor", input.cursor);

      const response = await fetch(`/api/personal-assets?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("加载素材失败");
      const payload = (await response.json()) as ListState;
      setList((current) => ({
        ...payload,
        items: input?.append
          ? [...current.items, ...payload.items]
          : payload.items,
      }));
    },
    [category, search, sort],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        await fetchList();
        if (!cancelled) window.scrollTo({ top: 0, behavior: "auto" });
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "加载素材失败",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchList]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !list.nextCursor || loadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      setLoadingMore(true);
      void fetchList({ append: true, cursor: list.nextCursor })
        .catch(() => setError("加载更多失败"))
        .finally(() => setLoadingMore(false));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchList, list.nextCursor, loadingMore]);

  useEffect(() => {
    return () => {
      for (const item of uploadQueue) URL.revokeObjectURL(item.previewUrl);
    };
  }, [uploadQueue]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (previewId) {
          setPreviewId(null);
          return;
        }
        if (contextMenu) {
          setContextMenu(null);
          return;
        }
        if (detailsCard) {
          setDetailsCard(null);
          return;
        }
        if (batchMode) {
          setBatchMode(false);
          setSelectedIds(new Set());
          setShowSelectedOnly(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [batchMode, contextMenu, detailsCard, previewId]);

  useEffect(() => {
    if (!previewId) return;
    const state = { personalAssetsPreview: previewId };
    window.history.pushState(state, "");
    const onPopState = () => {
      setPreviewId(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [previewId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    return () => {
      setBatchMode(false);
      setSelectedIds(new Set());
      setShowSelectedOnly(false);
    };
  }, []);

  const refreshList = useCallback(async () => {
    await fetchList();
  }, [fetchList]);

  const toggleSelected = useCallback((assetId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  const handleCardClick = useCallback(
    (asset: PersonalAsset) => {
      if (batchMode) {
        toggleSelected(asset.id);
        return;
      }
      setPreviewId(asset.id);
      setPreviewTransform({ scale: 1, translateX: 0, translateY: 0 });
    },
    [batchMode, toggleSelected],
  );

  const openContextMenu = useCallback(
    (asset: PersonalAsset, x: number, y: number) => {
      setContextMenu({ asset, x, y, showCategoryMenu: false });
      setDetailsCard(null);
    },
    [],
  );

  const handleDelete = useCallback(
    async (asset: PersonalAsset) => {
      if (!window.confirm(`确定删除「${asset.name}」吗？`)) return;
      const response = await fetch(
        `/api/personal-assets/${encodeURIComponent(asset.id)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!response.ok) {
        setError("删除失败");
        return;
      }
      if (previewId === asset.id) {
        const next =
          visibleItems[previewIndex + 1] ?? visibleItems[previewIndex - 1] ?? null;
        setPreviewId(next?.id ?? null);
      }
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(asset.id);
        return next;
      });
      await refreshList();
    },
    [previewId, previewIndex, refreshList, visibleItems],
  );

  const handleBulkDelete = useCallback(async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!window.confirm(`将永久删除 ${count} 个素材`)) return;
    const response = await fetch("/api/personal-assets/bulk-delete", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selectedIds) }),
    });
    if (!response.ok) {
      setError("批量删除失败");
      return;
    }
    setSelectedIds(new Set());
    setShowSelectedOnly(false);
    setBatchMode(false);
    setPreviewId(null);
    await refreshList();
  }, [refreshList, selectedIds]);

  const handleBulkDownload = useCallback(async () => {
    const selected = list.items.filter((item) => selectedIds.has(item.id));
    if (selected.length === 0) return;
    try {
      for (const [index, asset] of selected.entries()) {
        await downloadAssetFile(asset);
        if (index < selected.length - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
      }
    } catch {
      setError("浏览器可能阻止了多文件下载，请授权后重试");
    }
  }, [list.items, selectedIds]);

  const enqueueFiles = useCallback((files: File[]) => {
    const valid = files.filter(isImageFile);
    if (valid.length === 0) return;
    setUploadQueue((current) => [
      ...current,
      ...valid.map((file) => createQueueItem(file)),
    ]);
    setUploadPanelOpen(true);
    setQueueCollapsed(false);
    setQueueSummary(null);
  }, []);

  const handleIncomingFiles = useCallback(
    (files: File[], fromDrag = false) => {
      const valid = files.filter(isImageFile);
      if (valid.length === 0) return;
      if (!fromDrag) {
        enqueueFiles(valid);
        return;
      }
      const confirmed =
        window.localStorage.getItem(PERSONAL_ASSET_DRAG_CONFIRM_KEY) === "1";
      if (confirmed) {
        enqueueFiles(valid);
        return;
      }
      setPendingDragFiles(valid);
      setDragConfirmCount(valid.length);
    },
    [enqueueFiles],
  );

  const startUpload = useCallback(async () => {
    if (uploadQueue.length === 0 || uploading) return;
    setUploading(true);
    setQueueCollapsed(false);
    setQueueSummary(null);

    const queueSnapshot = [...uploadQueue];
    let successCount = 0;
    let failCount = 0;

    for (const item of queueSnapshot) {
      if (item.status === "completed" || item.status === "cancelled") continue;
      setUploadQueue((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, status: "uploading" } : entry,
        ),
      );

      const form = new FormData();
      form.set("file", item.file);
      form.set("name", item.name.trim() || defaultAssetName(item.file));
      form.set("category", uploadCategory);

      try {
        const response = await fetch("/api/personal-assets/upload", {
          method: "POST",
          body: form,
          credentials: "include",
        });
        const payload = (await response.json().catch(() => null)) as {
          asset?: PersonalAsset;
          error?: string;
          code?: string;
        } | null;
        if (!response.ok) {
          throw new Error(payload?.error ?? "上传失败");
        }
        successCount += 1;
        setUploadQueue((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? { ...entry, status: "completed", asset: payload?.asset }
              : entry,
          ),
        );
      } catch (uploadError) {
        failCount += 1;
        const message =
          uploadError instanceof Error ? uploadError.message : "上传失败";
        setUploadQueue((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? { ...entry, status: "failed", error: message }
              : entry,
          ),
        );
      }
    }

    setUploading(false);
    await refreshList();
    setQueueSummary(`成功 ${successCount} 个，失败 ${failCount} 个`);
    setQueueCollapsed(true);
  }, [refreshList, uploadCategory, uploadQueue, uploading]);

  const retryFailedUploads = useCallback(() => {
    setUploadQueue((current) =>
      current.map((item) =>
        item.status === "failed" ? { ...item, status: "pending", error: undefined } : item,
      ),
    );
    setQueueCollapsed(false);
    setQueueSummary(null);
  }, []);

  const activeUploadCount = uploadQueue.filter(
    (item) => item.status === "pending" || item.status === "uploading",
  ).length;
  const failedUploadCount = uploadQueue.filter(
    (item) => item.status === "failed",
  ).length;

  const shiftPreview = useCallback(
    (direction: -1 | 1) => {
      if (previewIndex < 0) return;
      const next = visibleItems[previewIndex + direction];
      if (!next) return;
      setPreviewId(next.id);
      setPreviewTransform({ scale: 1, translateX: 0, translateY: 0 });
    },
    [previewIndex, visibleItems],
  );

  const saveRename = useCallback(async () => {
    if (!renameTarget) return;
    const name = renameDraft.trim();
    if (!name) return;
    const response = await fetch(
      `/api/personal-assets/${encodeURIComponent(renameTarget.id)}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    if (!response.ok) {
      setError("重命名失败");
      return;
    }
    setRenameTarget(null);
    setContextMenu(null);
    await refreshList();
  }, [refreshList, renameDraft, renameTarget]);

  const saveCategory = useCallback(
    async (asset: PersonalAsset, nextCategory: PersonalAssetCategory) => {
      const response = await fetch(
        `/api/personal-assets/${encodeURIComponent(asset.id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: nextCategory }),
        },
      );
      if (!response.ok) {
        setError("修改分类失败");
        return;
      }
      setContextMenu(null);
      await refreshList();
    },
    [refreshList],
  );

  const onPreviewTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      previewTouchRef.current = {
        startX: 0,
        startY: 0,
        scale: previewTransform.scale,
        translateX: previewTransform.translateX,
        translateY: previewTransform.translateY,
        pinching: true,
      };
      return;
    }
    if (event.touches.length === 1) {
      previewTouchRef.current = {
        startX: event.touches[0].clientX,
        startY: event.touches[0].clientY,
        scale: previewTransform.scale,
        translateX: previewTransform.translateX,
        translateY: previewTransform.translateY,
        pinching: false,
      };
    }
  };

  const onPreviewTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = previewTouchRef.current;
    if (!touch) return;
    if (event.touches.length === 2 && touch.pinching) {
      const distance = Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY,
      );
      const nextScale = Math.min(3, Math.max(1, touch.scale * (distance / 180)));
      setPreviewTransform((current) => ({ ...current, scale: nextScale }));
      return;
    }
    if (event.touches.length === 1 && !touch.pinching && previewTransform.scale > 1) {
      const deltaX = event.touches[0].clientX - touch.startX;
      const deltaY = event.touches[0].clientY - touch.startY;
      setPreviewTransform({
        scale: previewTransform.scale,
        translateX: touch.translateX + deltaX,
        translateY: touch.translateY + deltaY,
      });
    }
  };

  const onPreviewTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = previewTouchRef.current;
    if (!touch || touch.pinching) {
      previewTouchRef.current = null;
      return;
    }
    const end = event.changedTouches[0];
    const deltaX = end.clientX - touch.startX;
    if (previewTransform.scale === 1 && Math.abs(deltaX) > 60) {
      shiftPreview(deltaX > 0 ? -1 : 1);
    }
    previewTouchRef.current = null;
  };

  const totalCategoryCount = useMemo(
    () =>
      Object.values(list.categoryCounts).reduce((sum, count) => sum + count, 0),
    [list.categoryCounts],
  );

  return (
    <div
      className="personal-assets-page"
      data-testid="personal-assets-page"
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        if (event.dataTransfer.files.length > 0) {
          handleIncomingFiles(Array.from(event.dataTransfer.files), true);
        }
      }}
    >
      <header className="personal-assets-header">
        <div className="personal-assets-header__title">
          <h1>个人素材</h1>
          <div className="personal-assets-header__usage">
            <div className="personal-assets-header__usage-label">
              <span>容量</span>
              <span>{formatUsage(list.usedBytes, list.quotaBytes)}</span>
            </div>
            <div className="personal-assets-header__usage-bar">
              <div
                className={`personal-assets-header__usage-fill${
                  usagePct >= 100
                    ? " is-full"
                    : usagePct >= 80
                      ? " is-warning"
                      : ""
                }`}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          </div>
        </div>
        <div className="personal-assets-header__actions">
          <button
            type="button"
            className="hub-btn hub-btn--primary"
            data-testid="personal-assets-upload-btn"
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <Upload size={15} aria-hidden />
            上传素材
          </button>
          <button
            type="button"
            className="hub-btn hub-btn--glass"
            data-testid="personal-assets-batch-btn"
            onClick={() => {
              setBatchMode((open) => !open);
              if (batchMode) {
                setSelectedIds(new Set());
                setShowSelectedOnly(false);
              }
            }}
          >
            {batchMode ? "退出批量管理" : "批量管理"}
          </button>
        </div>
      </header>

      <div className="personal-assets-toolbar">
        <div className="personal-assets-toolbar__categories">
          {PERSONAL_ASSET_CATEGORY_OPTIONS.map((option) => {
            const count =
              option.id === "all"
                ? totalCategoryCount
                : list.categoryCounts[option.id];
            return (
              <button
                key={option.id}
                type="button"
                className={`personal-assets-toolbar__category${
                  category === option.id ? " is-active" : ""
                }`}
                onClick={() => setCategory(option.id)}
              >
                <span>{option.label}</span>
                <span className="personal-assets-toolbar__category-count">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <label className="personal-assets-toolbar__search">
          <Search size={15} aria-hidden />
          <input
            value={searchDraft}
            placeholder="搜索素材"
            data-testid="personal-assets-search"
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setSearch(searchDraft);
            }}
          />
        </label>

        <label className="personal-assets-toolbar__sort">
          <select
            value={sort}
            data-testid="personal-assets-sort"
            onChange={(event) =>
              setSort(event.target.value as PersonalAssetSort)
            }
          >
            {PERSONAL_ASSET_SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {showSelectedOnly ? (
          <button
            type="button"
            className="hub-btn hub-btn--glass"
            onClick={() => setShowSelectedOnly(false)}
          >
            返回全部
          </button>
        ) : null}
      </div>

      {error ? <p className="personal-video-editor__error">{error}</p> : null}

      <div className="personal-assets-grid" data-testid="personal-assets-grid">
        {loading ? (
          <p className="personal-assets-empty">正在加载素材…</p>
        ) : visibleItems.length === 0 ? (
          <p className="personal-assets-empty">
            {showSelectedOnly ? "当前没有已选素材" : "暂无素材，先上传一张试试"}
          </p>
        ) : (
          visibleItems.map((asset) => (
            <article
              key={asset.id}
              className={`personal-asset-card${
                selectedIds.has(asset.id) ? " is-selected" : ""
              }`}
              data-testid="personal-asset-card"
            >
              <div
                className="personal-asset-card__frame"
                onClick={() => handleCardClick(asset)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openContextMenu(asset, event.clientX, event.clientY);
                }}
                onTouchStart={() => {
                  longPressTimerRef.current = window.setTimeout(() => {
                    const rect = document
                      .querySelector(`[data-asset-id="${asset.id}"]`)
                      ?.getBoundingClientRect();
                    openContextMenu(
                      asset,
                      rect?.left ?? 24,
                      rect?.top ?? 24,
                    );
                  }, 500);
                }}
                onTouchEnd={() => {
                  if (longPressTimerRef.current) {
                    window.clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                  }
                }}
                data-asset-id={asset.id}
              >
                {batchMode ? (
                  <span className="personal-asset-card__checkbox" aria-hidden>
                    {selectedIds.has(asset.id) ? <Check size={14} /> : null}
                  </span>
                ) : null}
                <img src={assetImageUrl(asset)} alt={asset.name} />
                <div className="personal-asset-card__actions">
                  <a
                    className="personal-asset-card__action"
                    href={assetDownloadUrl(asset)}
                    aria-label="下载"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Download size={14} />
                  </a>
                  <button
                    type="button"
                    className="personal-asset-card__action"
                    aria-label="删除"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDelete(asset);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p className="personal-asset-card__name" title={asset.name}>
                {asset.name}
              </p>
            </article>
          ))
        )}
      </div>

      {list.nextCursor ? (
        <div ref={loadMoreRef} className="personal-assets-load-more">
          {loadingMore ? "加载更多…" : ""}
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="sr-only"
        onChange={(event) => {
          if (event.target.files?.length) {
            handleIncomingFiles(Array.from(event.target.files));
          }
          event.target.value = "";
        }}
      />

      {dragActive ? (
        <div className="personal-assets-drag-overlay">释放以上传</div>
      ) : null}

      {dragConfirmCount > 0 ? (
        <div className="personal-assets-dialog-backdrop">
          <div className="personal-assets-dialog">
            <p>
              检测到你拖入了 {dragConfirmCount} 张图片，是否上传到个人素材？
            </p>
            <div className="personal-assets-dialog__actions">
              <button
                type="button"
                className="hub-btn hub-btn--glass"
                onClick={() => {
                  setPendingDragFiles([]);
                  setDragConfirmCount(0);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="hub-btn hub-btn--primary"
                onClick={() => {
                  window.localStorage.setItem(
                    PERSONAL_ASSET_DRAG_CONFIRM_KEY,
                    "1",
                  );
                  enqueueFiles(pendingDragFiles);
                  setPendingDragFiles([]);
                  setDragConfirmCount(0);
                }}
              >
                上传
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {uploadPanelOpen ? (
        <>
          <button
            type="button"
            className="personal-assets-dialog-backdrop"
            aria-label="关闭上传面板"
            onClick={() => setUploadPanelOpen(false)}
          />
          <aside
            className="personal-assets-upload-panel personal-assets-upload-panel--desktop"
            data-testid="personal-assets-upload-panel"
          >
            <div className="personal-assets-upload-panel__header">
              <div>
                <h2>上传确认</h2>
                <p>
                  待上传 {uploadQueue.length} 张，预计占用{" "}
                  {formatUsage(
                    uploadQueue.reduce((sum, item) => sum + item.file.size, 0),
                    list.quotaBytes,
                  )}
                </p>
              </div>
              <button
                type="button"
                className="hub-btn hub-btn--glass"
                onClick={() => setUploadPanelOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="personal-assets-upload-panel__body">
              <label>
                统一分类
                <select
                  value={uploadCategory}
                  onChange={(event) =>
                    setUploadCategory(event.target.value as PersonalAssetCategory)
                  }
                >
                  {PERSONAL_ASSET_CATEGORY_OPTIONS.filter(
                    (option) => option.id !== "all",
                  ).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {uploadQueue.map((item) => (
                <div key={item.id} className="personal-assets-upload-item">
                  <img src={item.previewUrl} alt="" />
                  <div>
                    <input
                      value={item.name}
                      onChange={(event) =>
                        setUploadQueue((current) =>
                          current.map((entry) =>
                            entry.id === item.id
                              ? { ...entry, name: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                    <p>
                      {item.status === "uploading"
                        ? "上传中"
                        : item.status === "completed"
                          ? "已入库"
                          : item.status === "failed"
                            ? item.error ?? "上传失败"
                            : "等待上传"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="hub-btn hub-btn--glass"
                    disabled={item.status === "uploading"}
                    onClick={() =>
                      setUploadQueue((current) =>
                        current.filter((entry) => entry.id !== item.id),
                      )
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
            <div className="personal-assets-upload-panel__footer">
              <button
                type="button"
                className="hub-btn hub-btn--glass"
                onClick={() => {
                  setUploadQueue((current) =>
                    current.filter(
                      (item) =>
                        item.status === "uploading" || item.status === "completed",
                    ),
                  );
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="hub-btn hub-btn--primary"
                disabled={uploading || uploadQueue.length === 0}
                onClick={() => void startUpload()}
              >
                {uploading ? "上传中…" : "开始上传"}
              </button>
            </div>
          </aside>
        </>
      ) : null}

      {(uploading || failedUploadCount > 0 || queueSummary) && queueCollapsed ? (
        <button
          type="button"
          className="personal-assets-upload-queue-fab"
          onClick={() => {
            setUploadPanelOpen(true);
            setQueueCollapsed(false);
          }}
        >
          {uploading
            ? `上传中 ${uploadQueue.filter((item) => item.status === "completed").length}/${uploadQueue.length}`
            : queueSummary ?? `失败 ${failedUploadCount} 个`}
        </button>
      ) : null}

      {queueSummary && !uploading ? (
        <div className="personal-assets-batch-bar">
          <span>{queueSummary}</span>
          <div>
            {failedUploadCount > 0 ? (
              <button
                type="button"
                className="hub-btn hub-btn--glass"
                onClick={retryFailedUploads}
              >
                全部重试
              </button>
            ) : null}
            <button
              type="button"
              className="hub-btn hub-btn--primary"
              onClick={() => setQueueSummary(null)}
            >
              关闭提示
            </button>
          </div>
        </div>
      ) : null}

      {batchMode ? (
        <div className="personal-assets-batch-bar" data-testid="personal-assets-batch-bar">
          <span>已选 {selectedIds.size} 项</span>
          <div>
            <button
              type="button"
              className="hub-btn hub-btn--glass"
              onClick={() => setShowSelectedOnly(true)}
            >
              查看已选
            </button>
            <button
              type="button"
              className="hub-btn hub-btn--glass"
              onClick={() => void handleBulkDownload()}
            >
              批量下载
            </button>
            <button
              type="button"
              className="hub-btn hub-btn--glass"
              onClick={() => void handleBulkDelete()}
            >
              批量删除
            </button>
            <button
              type="button"
              className="hub-btn hub-btn--primary"
              onClick={() => {
                setBatchMode(false);
                setSelectedIds(new Set());
                setShowSelectedOnly(false);
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <>
          <button
            type="button"
            className="personal-assets-dialog-backdrop"
            aria-label="关闭菜单"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="personal-assets-context-menu"
            style={clampPopoverPosition({
              x: contextMenu.x,
              y: contextMenu.y,
              width: 220,
              height: contextMenu.showCategoryMenu ? 280 : 240,
            })}
          >
            <button type="button" onClick={() => setContextMenu(null)}>
              用于 AI 生图
            </button>
            <button type="button" onClick={() => setContextMenu(null)}>
              用于 AI 生视频
            </button>
            <button
              type="button"
              onClick={() =>
                setContextMenu((current) =>
                  current ? { ...current, showCategoryMenu: !current.showCategoryMenu } : current,
                )
              }
            >
              修改分类
            </button>
            {contextMenu.showCategoryMenu ? (
              <div className="personal-assets-context-menu__submenu">
                {(["character", "scene", "prop", "other"] as const).map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={contextMenu.asset.category === value}
                      onClick={() => void saveCategory(contextMenu.asset, value)}
                    >
                      <span>{categoryLabel(value)}</span>
                      {contextMenu.asset.category === value ? (
                        <span>当前分类</span>
                      ) : null}
                    </button>
                  ),
                )}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setRenameTarget(contextMenu.asset);
                setRenameDraft(contextMenu.asset.name);
                setContextMenu(null);
              }}
            >
              重命名
            </button>
            <button
              type="button"
              onClick={() => {
                void downloadAssetFile(contextMenu.asset);
                setContextMenu(null);
              }}
            >
              下载
            </button>
            <button
              type="button"
              onClick={() => {
                setDetailsCard({
                  asset: contextMenu.asset,
                  x: contextMenu.x,
                  y: contextMenu.y,
                });
                setContextMenu(null);
              }}
            >
              详细信息
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={() => {
                void handleDelete(contextMenu.asset);
                setContextMenu(null);
              }}
            >
              删除
            </button>
          </div>
        </>
      ) : null}

      {detailsCard ? (
        <>
          <button
            type="button"
            className="personal-assets-dialog-backdrop"
            aria-label="关闭详情"
            onClick={() => setDetailsCard(null)}
          />
          <div
            className="personal-assets-details-card"
            style={clampPopoverPosition({
              x: detailsCard.x,
              y: detailsCard.y,
              width: 360,
              height: 320,
            })}
          >
            <h3>详细信息</h3>
            <dl>
              <dt>文件名</dt>
              <dd>{detailsCard.asset.name}</dd>
              <dt>分类</dt>
              <dd>{categoryLabel(detailsCard.asset.category)}</dd>
              <dt>图片尺寸</dt>
              <dd>
                {detailsCard.asset.width} × {detailsCard.asset.height}
              </dd>
              <dt>文件大小</dt>
              <dd>{formatPersonalAssetBytes(detailsCard.asset.sizeBytes)}</dd>
              <dt>上传时间</dt>
              <dd>{formatAssetDate(detailsCard.asset.createdAt)}</dd>
              <dt>来源类型</dt>
              <dd>{sourceTypeLabel(detailsCard.asset)}</dd>
              {detailsCard.asset.sourceType === "ai_image" ? (
                <>
                  <dt>比例</dt>
                  <dd>{detailsCard.asset.aspectRatio ?? "—"}</dd>
                  <dt>画质</dt>
                  <dd>{detailsCard.asset.quality ?? "—"}</dd>
                  <dt>模型</dt>
                  <dd>{detailsCard.asset.modelId ?? "—"}</dd>
                  <dt>生成时间</dt>
                  <dd>
                    {detailsCard.asset.generatedAt
                      ? formatAssetDate(detailsCard.asset.generatedAt)
                      : "—"}
                  </dd>
                  <dt>原始提示词</dt>
                  <dd className="personal-assets-details-card__prompt">
                    {detailsCard.asset.prompt ?? "—"}
                  </dd>
                </>
              ) : null}
            </dl>
            {detailsCard.asset.prompt ? (
              <button
                type="button"
                className="hub-btn hub-btn--glass"
                onClick={() => {
                  void navigator.clipboard.writeText(detailsCard.asset.prompt ?? "");
                }}
              >
                <Copy size={14} aria-hidden />
                复制
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {renameTarget ? (
        <div className="personal-assets-dialog-backdrop">
          <div className="personal-assets-dialog">
            <h3>重命名</h3>
            <input
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
            />
            <div className="personal-assets-dialog__actions">
              <button
                type="button"
                className="hub-btn hub-btn--glass"
                onClick={() => setRenameTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="hub-btn hub-btn--primary"
                onClick={() => void saveRename()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewItem ? (
        <div
          className="personal-assets-preview"
          data-testid="personal-assets-preview"
          onClick={() => setPreviewId(null)}
        >
          <div
            className="personal-assets-preview__panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="personal-assets-preview__topbar">
              <p className="personal-assets-preview__title">{previewItem.name}</p>
              <div className="personal-assets-preview__actions">
                <a
                  className="hub-btn hub-btn--glass"
                  href={assetDownloadUrl(previewItem)}
                >
                  <Download size={15} aria-hidden />
                  下载
                </a>
                <button
                  type="button"
                  className="hub-btn hub-btn--glass"
                  onClick={() => setPreviewId(null)}
                >
                  <X size={15} aria-hidden />
                  关闭
                </button>
              </div>
            </div>
            <div className="personal-assets-preview__stage">
              {previewIndex > 0 ? (
                <button
                  type="button"
                  className="personal-assets-preview__nav personal-assets-preview__nav--left"
                  onClick={() => shiftPreview(-1)}
                >
                  <ChevronLeft size={18} aria-hidden />
                </button>
              ) : null}
              <div
                className="personal-assets-preview__image-wrap"
                onTouchStart={onPreviewTouchStart}
                onTouchMove={onPreviewTouchMove}
                onTouchEnd={onPreviewTouchEnd}
                style={{
                  transform: `translate(${previewTransform.translateX}px, ${previewTransform.translateY}px) scale(${previewTransform.scale})`,
                }}
              >
                <img src={assetImageUrl(previewItem)} alt={previewItem.name} />
              </div>
              {previewIndex < visibleItems.length - 1 ? (
                <button
                  type="button"
                  className="personal-assets-preview__nav personal-assets-preview__nav--right"
                  onClick={() => shiftPreview(1)}
                >
                  <ChevronRight size={18} aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
