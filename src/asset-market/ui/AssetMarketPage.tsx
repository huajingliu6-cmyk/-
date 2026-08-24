"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, RefreshCw, Search, Store, X } from "lucide-react";
import {
  MARKET_ASSET_CATEGORIES,
  MARKET_CATEGORY_LABELS,
} from "@/asset-market/constants";
import type {
  MarketAsset,
  MarketAssetCategory,
  MarketAssetSort,
} from "@/asset-market/types";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import {
  readCurrentProjectId,
  writeCurrentProjectId,
} from "@/shell/current-project-context";
import {
  AppToastHost,
  useAppToasts,
} from "@/shell/AppToast";
import { useAuthUser } from "@/shell/useAuthUser";
import "@/personal/ui/personal-hub-controls.css";
import "@/asset-market/ui/asset-market-page.css";

type CategoryState = {
  keyword: string;
  sort: MarketAssetSort;
  scrollTop: number;
};

type ProjectOption = { projectId: string; name: string };

const SORT_OPTIONS: Array<{ id: MarketAssetSort; label: string }> = [
  { id: "latest", label: "最新发布" },
  { id: "updated", label: "更新时间" },
  { id: "usage", label: "使用次数" },
];

const EMPTY_COUNTS: Record<MarketAssetCategory, number> = {
  character: 0,
  clothing: 0,
  scene: 0,
  prop: 0,
};

function defaultCategoryState(): CategoryState {
  return {
    keyword: "",
    sort: "latest",
    scrollTop: 0,
  };
}

function buildInitialCategoryState(): Record<MarketAssetCategory, CategoryState> {
  return {
    character: defaultCategoryState(),
    clothing: defaultCategoryState(),
    scene: defaultCategoryState(),
    prop: defaultCategoryState(),
  };
}

function visibleTags(tags: string[], limit = 3): string[] {
  return tags.filter(Boolean).slice(0, limit);
}

export function AssetMarketPage() {
  const auth = useAuthUser();
  const { toasts, pushToast, dismiss, pause, resume } = useAppToasts();

  const [category, setCategory] = useState<MarketAssetCategory>("character");
  const categoryStateRef = useRef(buildInitialCategoryState());
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [sort, setSort] = useState<MarketAssetSort>("latest");
  const [items, setItems] = useState<MarketAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [categoryCounts, setCategoryCounts] =
    useState<Record<MarketAssetCategory, number>>(EMPTY_COUNTS);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Set<string>>(() => new Set());
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [importProjectId, setImportProjectId] = useState("");
  const [drawerItem, setDrawerItem] = useState<MarketAsset | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<MarketAsset | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);

  const gridScrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const stored = readCurrentProjectId();
    if (stored) setImportProjectId(stored);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const loadPage = useCallback(
    async (input: {
      reset: boolean;
      cursor?: string | null;
      signal?: AbortSignal;
      requestId: number;
    }) => {
      const params = new URLSearchParams();
      params.set("category", category);
      params.set("sort", sort);
      params.set("limit", "24");
      if (debouncedKeyword.trim()) params.set("keyword", debouncedKeyword.trim());
      if (!input.reset && input.cursor) params.set("cursor", input.cursor);

      const response = await fetch(`/api/asset-market?${params.toString()}`, {
        cache: "no-store",
        signal: input.signal,
        credentials: "include",
      });
      const data = await parseResponseJson<{
        items?: MarketAsset[];
        nextCursor?: string | null;
        total?: number;
        categoryCounts?: Record<MarketAssetCategory, number>;
        error?: string;
      }>(response);

      if (input.signal?.aborted || input.requestId !== requestIdRef.current) {
        return;
      }
      if (!response.ok) {
        throw new Error(data.error || "加载失败");
      }

      setItems((current) =>
        input.reset ? (data.items ?? []) : [...current, ...(data.items ?? [])],
      );
      setNextCursor(data.nextCursor ?? null);
      setTotal(data.total ?? 0);
      if (data.categoryCounts) setCategoryCounts(data.categoryCounts);
      setLoadError(null);
    },
    [category, debouncedKeyword, sort],
  );

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        await loadPage({ reset: true, signal: controller.signal, requestId });
      } catch {
        if (controller.signal.aborted) return;
        if (requestId !== requestIdRef.current) return;
        setItems([]);
        setLoadError("加载失败，请重试");
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [auth.status, loadPage]);

  useEffect(() => {
    if (!drawerItem || auth.status !== "authenticated") {
      setDrawerDetail(null);
      setDrawerLoading(false);
      return;
    }
    let cancelled = false;
    setDrawerLoading(true);
    void (async () => {
      try {
        const response = await fetch(
          `/api/asset-market/${encodeURIComponent(drawerItem.id)}`,
          { credentials: "include" },
        );
        const data = await parseResponseJson<{ item?: MarketAsset; error?: string }>(
          response,
        );
        if (!cancelled && response.ok) {
          setDrawerDetail(data.item ?? drawerItem);
        } else if (!cancelled) {
          setDrawerDetail(drawerItem);
        }
      } catch {
        if (!cancelled) setDrawerDetail(drawerItem);
      } finally {
        if (!cancelled) setDrawerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status, drawerItem]);

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/projects?pageSize=100", {
          credentials: "include",
        });
        const data = await parseResponseJson<{
          projects?: Array<{ projectId: string; name: string }>;
        }>(response, { allowEmpty: true });
        if (cancelled || !response.ok) return;
        setProjects(
          (data?.projects ?? []).map((project) => ({
            projectId: project.projectId,
            name: project.name,
          })),
        );
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !nextCursor || loadingMore || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingMore) return;
        setLoadingMore(true);
        void loadPage({
          reset: false,
          cursor: nextCursor,
          requestId: requestIdRef.current,
        })
          .catch(() => pushToast("加载更多失败"))
          .finally(() => setLoadingMore(false));
      },
      { root: gridScrollRef.current, rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadPage, loading, loadingMore, nextCursor, pushToast]);

  const switchCategory = useCallback(
    (next: MarketAssetCategory) => {
      if (next === category) return;
      const scrollTop = gridScrollRef.current?.scrollTop ?? 0;
      categoryStateRef.current[category] = {
        keyword,
        sort,
        scrollTop,
      };
      const restored = categoryStateRef.current[next] ?? defaultCategoryState();
      setCategory(next);
      setKeyword(restored.keyword);
      setDebouncedKeyword(restored.keyword);
      setSort(restored.sort);
      setDrawerItem(null);
      requestAnimationFrame(() => {
        if (gridScrollRef.current) {
          gridScrollRef.current.scrollTop = restored.scrollTop;
        }
      });
    },
    [category, keyword, sort],
  );

  const markItemAdded = useCallback((assetId: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === assetId ? { ...item, addedToPersonal: true } : item,
      ),
    );
    setDrawerDetail((current) =>
      current?.id === assetId
        ? { ...current, addedToPersonal: true }
        : current,
    );
    setDrawerItem((current) =>
      current?.id === assetId
        ? { ...current, addedToPersonal: true }
        : current,
    );
  }, []);

  const handleAddToPersonal = useCallback(
    async (item: MarketAsset) => {
      if (item.addedToPersonal || addingIds.has(item.id)) return;
      setAddingIds((current) => new Set(current).add(item.id));
      try {
        const response = await fetch(
          `/api/asset-market/${encodeURIComponent(item.id)}/add-to-personal`,
          { method: "POST", credentials: "include" },
        );
        const data = await parseResponseJson<{
          alreadyAdded?: boolean;
          error?: string;
        }>(response);
        if (!response.ok) throw new Error(data.error || "添加失败");
        markItemAdded(item.id);
        pushToast(data.alreadyAdded ? "已在个人素材中" : "已添加到个人素材");
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "添加失败");
      } finally {
        setAddingIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }
    },
    [addingIds, markItemAdded, pushToast],
  );

  const handleAddToProject = useCallback(
    async (item: MarketAsset) => {
      if (!importProjectId.trim()) {
        pushToast("请先选择项目");
        return;
      }
      setProjectBusy(true);
      try {
        const response = await fetch(
          `/api/asset-market/${encodeURIComponent(item.id)}/add-to-project`,
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: importProjectId.trim() }),
          },
        );
        const data = await parseResponseJson<{ error?: string }>(response);
        if (!response.ok) throw new Error(data.error || "添加失败");
        writeCurrentProjectId(importProjectId.trim());
        pushToast("已添加到项目");
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "添加失败");
      } finally {
        setProjectBusy(false);
      }
    },
    [importProjectId, pushToast],
  );

  const displayItem = drawerDetail ?? drawerItem;
  const categoryLabel = useMemo(
    () => MARKET_CATEGORY_LABELS[category],
    [category],
  );

  return (
    <div className="asset-market-page" data-testid="asset-market-page">
      <header className="asset-market-page__header">
        <div className="asset-market-page__title-row">
          <Store size={22} aria-hidden />
          <div className="asset-market-page__title-copy">
            <h1>素材市场</h1>
            <p>浏览平台公共素材，添加到个人素材或当前项目</p>
          </div>
        </div>

        <div className="asset-market-page__toolbar">
          <label className="asset-market-page__search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              placeholder="搜索素材名称或标签"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              data-testid="asset-market-search"
            />
          </label>

          <select
            className="asset-market-page__sort"
            value={sort}
            onChange={(event) =>
              startTransition(() =>
                setSort(event.target.value as MarketAssetSort),
              )
            }
            data-testid="asset-market-sort"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <nav className="asset-market-page__categories" aria-label="素材分类">
        {MARKET_ASSET_CATEGORIES.map((entry) => (
          <button
            key={entry}
            type="button"
            className={`asset-market-page__category${
              category === entry ? " is-active" : ""
            }`}
            onClick={() => switchCategory(entry)}
            data-testid={`asset-market-category-${entry}`}
          >
            <span className="asset-market-page__category-label">
              {MARKET_CATEGORY_LABELS[entry]}
            </span>
            <span className="asset-market-page__category-count">
              {categoryCounts[entry] ?? 0}
            </span>
          </button>
        ))}
      </nav>

      <section
        className="asset-market-page__content"
        aria-label={`${categoryLabel}素材`}
      >
        <div className="asset-market-page__content-head">
          <h2>{categoryLabel}</h2>
          <span>{total} 项</span>
        </div>

        <div ref={gridScrollRef} className="asset-market-page__grid-scroll">
          {loading ? (
            <p className="asset-market-page__empty">
              <Loader2 className="asset-market-spin" size={18} aria-hidden />
              加载中…
            </p>
          ) : loadError ? (
            <div className="asset-market-page__empty">
              <p>{loadError}</p>
              <button
                type="button"
                className="hub-btn hub-btn--glass"
                onClick={() => {
                  requestIdRef.current += 1;
                  setLoading(true);
                  void loadPage({
                    reset: true,
                    requestId: requestIdRef.current,
                  }).finally(() => setLoading(false));
                }}
              >
                <RefreshCw size={14} aria-hidden />
                重试
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="asset-market-page__empty">
              <p>暂无可用素材</p>
            </div>
          ) : (
            <>
              <div
                className="asset-market-page__grid"
                data-testid="asset-market-grid"
              >
                {items.map((item) => {
                  const tags = visibleTags(item.tags);
                  const isAdding = addingIds.has(item.id);
                  return (
                    <article
                      key={item.id}
                      className="asset-market-card"
                      data-testid="asset-market-card"
                    >
                      <button
                        type="button"
                        className="asset-market-card__preview"
                        onClick={() => setDrawerItem(item)}
                        aria-label={`查看 ${item.name}`}
                      >
                        <img
                          src={item.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          width={240}
                          height={180}
                        />
                      </button>
                      <div className="asset-market-card__body">
                        <button
                          type="button"
                          className="asset-market-card__title"
                          onClick={() => setDrawerItem(item)}
                        >
                          {item.name}
                        </button>
                        <p className="asset-market-card__meta">
                          {MARKET_CATEGORY_LABELS[item.category]}
                        </p>
                        {tags.length > 0 ? (
                          <div className="asset-market-card__tags">
                            {tags.map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className={`hub-btn hub-btn--glass asset-market-card__add${
                            item.addedToPersonal ? " is-added" : ""
                          }`}
                          disabled={item.addedToPersonal || isAdding}
                          onClick={() => void handleAddToPersonal(item)}
                          data-testid="asset-market-add-personal"
                        >
                          {isAdding ? (
                            <Loader2
                              size={14}
                              className="asset-market-spin"
                              aria-hidden
                            />
                          ) : null}
                          {item.addedToPersonal ? "已添加" : "添加到个人素材"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div ref={loadMoreRef} className="asset-market-page__load-more">
                {loadingMore ? (
                  <span>
                    <Loader2
                      size={16}
                      className="asset-market-spin"
                      aria-hidden
                    />
                    加载更多…
                  </span>
                ) : nextCursor ? (
                  <span>继续下滑加载更多</span>
                ) : null}
              </div>
            </>
          )}
        </div>
      </section>

      {drawerItem ? (
        <>
          <button
            type="button"
            className="asset-market-page__drawer-backdrop"
            aria-label="关闭素材详情"
            onClick={() => setDrawerItem(null)}
          />
          <aside
            className="asset-market-page__drawer"
            data-testid="asset-market-drawer"
            aria-label="素材详情"
          >
            <header className="asset-market-page__drawer-header">
              <h2>素材详情</h2>
              <button
                type="button"
                className="asset-market-page__drawer-close"
                aria-label="关闭"
                onClick={() => setDrawerItem(null)}
              >
                <X size={18} aria-hidden />
              </button>
            </header>

            <div className="asset-market-page__drawer-body">
              {drawerLoading ? (
                <p className="asset-market-page__drawer-loading">
                  <Loader2 className="asset-market-spin" size={18} aria-hidden />
                  加载预览…
                </p>
              ) : displayItem ? (
                <>
                  <div className="asset-market-page__drawer-preview">
                    <img
                      src={displayItem.previewUrl}
                      alt={displayItem.name}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div className="asset-market-page__drawer-info">
                    <h3>{displayItem.name}</h3>
                    <p className="asset-market-page__drawer-category">
                      {MARKET_CATEGORY_LABELS[displayItem.category]}
                    </p>
                    {displayItem.tags.length > 0 ? (
                      <div className="asset-market-page__drawer-tags">
                        {displayItem.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    {displayItem.description ? (
                      <p className="asset-market-page__drawer-description">
                        {displayItem.description}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>

            {displayItem ? (
              <footer className="asset-market-page__drawer-footer">
                <button
                  type="button"
                  className="hub-btn hub-btn--primary"
                  disabled={
                    displayItem.addedToPersonal || addingIds.has(displayItem.id)
                  }
                  onClick={() => void handleAddToPersonal(displayItem)}
                >
                  {displayItem.addedToPersonal ? "已添加" : "添加到个人素材"}
                </button>
                <div className="asset-market-page__project-row">
                  <select
                    value={importProjectId}
                    onChange={(event) => {
                      const next = event.target.value;
                      setImportProjectId(next);
                      if (next.trim()) writeCurrentProjectId(next.trim());
                    }}
                  >
                    <option value="">选择项目</option>
                    {projects.map((project) => (
                      <option key={project.projectId} value={project.projectId}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="hub-btn hub-btn--glass"
                    disabled={projectBusy}
                    onClick={() => void handleAddToProject(displayItem)}
                  >
                    添加到当前项目
                  </button>
                </div>
              </footer>
            ) : null}
          </aside>
        </>
      ) : null}

      <AppToastHost
        toasts={toasts}
        onDismiss={dismiss}
        onPause={pause}
        onResume={resume}
      />
    </div>
  );
}
