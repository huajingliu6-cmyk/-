"use client";

import Link from "next/link";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  MATERIAL_GENDER_OPTIONS,
  MATERIAL_THEME_OPTIONS,
  MATERIAL_TYPE_LABELS,
  MATERIAL_TYPES,
  materialMediaUrl,
} from "@/materials/constants";
import type {
  Material,
  MaterialGenderTag,
  MaterialSort,
  MaterialType,
} from "@/materials/types";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import {
  AppToastHost,
  useAppToasts,
} from "@/shell/AppToast";
import { useAuthUser } from "@/shell/useAuthUser";
import "@/materials/materials.css";

type ProjectOption = { projectId: string; name: string };

type LibraryAsset = {
  id: string;
  name: string;
  type: MaterialType;
  mediaUrl: string;
  sourceMaterialId: string | null;
  sourceType?: string;
  description?: string;
  tags?: string[];
};

type SpaceTab = "personal" | "system";


function toggleValue<T extends string>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function MaterialsPage() {
  const auth = useAuthUser();
  const searchParams = useSearchParams();
  const { toasts, pushToast, dismiss, pause, resume } = useAppToasts();

  const isAdmin =
    auth.status === "authenticated" && auth.user.role === "admin";

  const [type, setType] = useState<MaterialType | "all">("clothing");
  const [spaceTab, setSpaceTab] = useState<SpaceTab>("personal");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<MaterialSort>("all");
  const [genders, setGenders] = useState<MaterialGenderTag[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([]);
  const [citedIds, setCitedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [selected, setSelected] = useState<Material | null>(null);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [importProjectId, setImportProjectId] = useState(
    () => searchParams.get("projectId")?.trim() || "",
  );
  const [importCharacterId, setImportCharacterId] = useState(
    () => searchParams.get("characterId")?.trim() || "",
  );

  const materialsRequestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  const loadLibrary = useCallback(async () => {
    const res = await fetch("/api/materials/my-library", { cache: "no-store" });
    const data = await parseResponseJson<{
      assets?: LibraryAsset[];
      library?: { citations?: Array<{ materialId: string }> };
      error?: string;
    }>(res);
    if (!res.ok) throw new Error(data.error || "加载我的素材库失败");
    setLibraryAssets(data.assets ?? []);
    setCitedIds(
      new Set(
        (data.assets ?? [])
          .map((item) => item.sourceMaterialId)
          .filter((id): id is string => Boolean(id && id.trim())),
      ),
    );
  }, []);

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    let cancelled = false;
    setLibraryLoading(true);
    void (async () => {
      try {
        await loadLibrary();
      } catch (error) {
        if (!cancelled) {
          pushToast(errorMessage(error, "加载我的素材库失败"));
        }
      } finally {
        if (!cancelled) setLibraryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status, loadLibrary, pushToast]);

  useEffect(() => {
    if (auth.status !== "authenticated") return;

    const controller = new AbortController();
    const requestId = ++materialsRequestId.current;

    setLoading(true);
    void (async () => {
      try {
        const params = new URLSearchParams();
        if (type !== "all") params.set("type", type);
        if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
        params.set("sort", sort);
        if (genders.length) params.set("genders", genders.join(","));
        if (themes.length) params.set("themes", themes.join(","));

        const res = await fetch(`/api/materials?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await parseResponseJson<{
          materials?: Material[];
          error?: string;
        }>(res);
        if (controller.signal.aborted || requestId !== materialsRequestId.current) {
          return;
        }
        if (!res.ok) throw new Error(data.error || "加载素材失败");
        setMaterials(data.materials ?? []);
      } catch (error) {
        if (isAbortError(error)) return;
        if (requestId !== materialsRequestId.current) return;
        pushToast(errorMessage(error, "加载素材失败"));
      } finally {
        if (requestId === materialsRequestId.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    auth.status,
    type,
    debouncedQ,
    sort,
    genders,
    themes,
    pushToast,
  ]);

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/projects?pageSize=100", {
          cache: "no-store",
        });
        const data = await parseResponseJson<{
          projects?: Array<{ projectId: string; name: string }>;
        }>(res, { allowEmpty: true });
        if (cancelled || !res.ok) return;
        setProjects(
          (data?.projects ?? []).map((p) => ({
            projectId: p.projectId,
            name: p.name,
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

  const visibleMaterials = useMemo(
    () => materials.filter((item) => item.status === "active"),
    [materials],
  );

  const applyFilters = useCallback((mutator: () => void) => {
    startTransition(() => {
      mutator();
    });
  }, []);

  const handleCite = async (material: Material) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/materials/${material.id}/cite`, {
        method: "POST",
      });
      const data = await parseResponseJson<{
        alreadyCited?: boolean;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || "引用失败");
      setCitedIds((prev) => new Set(prev).add(material.id));
      pushToast(data.alreadyCited ? "已在素材库中" : "已引用到我的素材库");
      await loadLibrary();
    } catch (error) {
      pushToast(errorMessage(error, "引用失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (material: Material) => {
    if (!importProjectId.trim()) {
      pushToast("请先选择要导入的项目");
      return;
    }
    if (material.type === "clothing" && !importCharacterId.trim()) {
      pushToast("衣服导入需要填写角色 ID");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/materials/${material.id}/import-to-project`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: importProjectId.trim(),
            characterId: importCharacterId.trim() || undefined,
          }),
        },
      );
      const data = await parseResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "导入失败");
      setCitedIds((prev) => new Set(prev).add(material.id));
      pushToast("已导入到项目资产库");
      await loadLibrary();
    } catch (error) {
      pushToast(errorMessage(error, "导入失败"));
    } finally {
      setBusy(false);
    }
  };

  if (auth.status === "loading") {
    return (
      <div className="me-page">
        <div className="me-loading">加载中…</div>
      </div>
    );
  }

  if (auth.status !== "authenticated") {
    return (
      <div className="me-page">
        <div className="me-empty">请先登录后使用素材引擎</div>
      </div>
    );
  }

  return (
    <div className="me-page">
      <header className="me-header">
        <h1>素材引擎</h1>
        {isAdmin ? (
          <Link href="/app/admin/materials" className="me-btn">
            素材管理
          </Link>
        ) : null}
      </header>

      <div
        className="me-space-tabs"
        role="tablist"
        aria-label="素材空间"
        data-testid="materials-space-tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={spaceTab === "personal"}
          className={`me-space-tab${spaceTab === "personal" ? " is-active" : ""}`}
          data-testid="materials-tab-personal"
          onClick={() => setSpaceTab("personal")}
        >
          个人空间
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={spaceTab === "system"}
          className={`me-space-tab${spaceTab === "system" ? " is-active" : ""}`}
          data-testid="materials-tab-system"
          onClick={() => setSpaceTab("system")}
        >
          系统素材
        </button>
      </div>

      <div className="me-body">
        <nav className="me-type-nav" aria-label="素材分类">
          <button
            type="button"
            className={`me-type-btn${type === "all" ? " is-active" : ""}`}
            onClick={() => applyFilters(() => setType("all"))}
          >
            全部
          </button>
          {MATERIAL_TYPES.map((id) => (
            <button
              key={id}
              type="button"
              className={`me-type-btn${type === id ? " is-active" : ""}`}
              onClick={() => applyFilters(() => setType(id))}
            >
              {MATERIAL_TYPE_LABELS[id]}
            </button>
          ))}
        </nav>

        <div className="me-main">
          {spaceTab === "personal" ? (
          <section className="me-library-section" aria-label="个人空间">
            <h2 className="me-section-title">个人空间</h2>
            <p className="me-section-desc">
              包含你上传保存的素材、从系统素材引用的素材，以及已保存的个人参考图。
            </p>
            {libraryLoading ? (
              <div className="me-loading me-loading-compact">加载中…</div>
            ) : libraryAssets.length === 0 ? (
              <div className="me-empty me-empty-compact">
                暂无个人素材。可切换到「系统素材」引用，或在造型编辑中保存上传图。
              </div>
            ) : (
              <div className="me-grid me-grid-compact">
                {libraryAssets
                  .filter(
                    (asset) => type === "all" || asset.type === type,
                  )
                  .map((asset) => (
                  <div key={asset.id} className="me-card me-card-static">
                    <div className="me-card-media">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={asset.mediaUrl} alt={asset.name} />
                    </div>
                    <div className="me-card-body">
                      <h3 className="me-card-title">{asset.name}</h3>
                      <div className="me-card-meta">
                        {MATERIAL_TYPE_LABELS[asset.type]}
                        {asset.sourceType === "system-citation"
                          ? " · 系统引用"
                          : asset.sourceType === "generated"
                            ? " · 生成"
                            : " · 上传"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          ) : (
          <>
          <div className="me-toolbar">
            <input
              className="me-search"
              placeholder="搜索名称、描述或标签"
              value={q}
              onChange={(e) => {
                const value = e.target.value;
                applyFilters(() => setQ(value));
              }}
            />
            <select
              className="me-select"
              value={sort}
              onChange={(e) => {
                const value = e.target.value as MaterialSort;
                applyFilters(() => setSort(value));
              }}
            >
              <option value="all">全部排序</option>
              <option value="newest">最新</option>
              <option value="popular">热门</option>
            </select>
          </div>

          {(type === "clothing" || type === "all") && (
            <>
              <div className="me-chip-row">
                <span className="me-chip-label">性别</span>
                {MATERIAL_GENDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`me-chip${genders.includes(opt.id) ? " is-active" : ""}`}
                    onClick={() =>
                      applyFilters(() =>
                        setGenders((prev) => toggleValue(prev, opt.id)),
                      )
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="me-chip-row">
                <span className="me-chip-label">主题</span>
                {MATERIAL_THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`me-chip${themes.includes(opt.id) ? " is-active" : ""}`}
                    onClick={() =>
                      applyFilters(() =>
                        setThemes((prev) => toggleValue(prev, opt.id)),
                      )
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {loading ? (
            <div className="me-loading">加载素材中…</div>
          ) : visibleMaterials.length === 0 ? (
            <div className="me-empty">暂无素材</div>
          ) : (
            <div className="me-grid">
              {visibleMaterials.map((material) => {
                const cited = citedIds.has(material.id);
                return (
                  <button
                    key={material.id}
                    type="button"
                    className="me-card"
                    onClick={() => setSelected(material)}
                  >
                    <div className="me-card-media">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={materialMediaUrl(material.mediaId)}
                        alt={material.name}
                      />
                    </div>
                    <div className="me-card-body">
                      <h3 className="me-card-title">{material.name}</h3>
                      <div className="me-card-meta">
                        {MATERIAL_TYPE_LABELS[material.type]}
                        {cited ? " · 已引用" : ""}
                        {` · ${material.citeCount} 次引用`}
                      </div>
                      <div className="me-card-tags">
                        {material.genderTags.slice(0, 2).map((tag) => (
                          <span key={tag} className="me-tag">
                            {MATERIAL_GENDER_OPTIONS.find((o) => o.id === tag)
                              ?.label ?? tag}
                          </span>
                        ))}
                        {material.themeTags.slice(0, 2).map((tag) => (
                          <span key={tag} className="me-tag">
                            {MATERIAL_THEME_OPTIONS.find((o) => o.id === tag)
                              ?.label ?? tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {selected ? (
        <div
          className="me-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelected(null)}
        >
          <div
            className="me-lightbox-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="me-lightbox-media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={materialMediaUrl(selected.mediaId)}
                alt={selected.name}
              />
            </div>
            <div className="me-lightbox-side">
              <h2>{selected.name}</h2>
              <div className="me-card-meta">
                {MATERIAL_TYPE_LABELS[selected.type]} · 引用{" "}
                {selected.citeCount} 次
                {citedIds.has(selected.id) ? " · 已在素材库" : ""}
              </div>
              <p className="me-lightbox-desc">
                {selected.description || "暂无描述"}
              </p>
              <div className="me-card-tags">
                {[
                  ...selected.genderTags,
                  ...selected.themeTags,
                  ...selected.tags,
                ].map((tag) => (
                  <span key={tag} className="me-tag">
                    {tag}
                  </span>
                ))}
              </div>

              <div className="me-import-row">
                <select
                  className="me-select"
                  value={importProjectId}
                  onChange={(e) => setImportProjectId(e.target.value)}
                >
                  <option value="">导入到项目…</option>
                  {projects.map((p) => (
                    <option key={p.projectId} value={p.projectId}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {selected.type === "clothing" ? (
                  <input
                    className="me-input"
                    placeholder="角色 ID（衣服必填）"
                    value={importCharacterId}
                    onChange={(e) => setImportCharacterId(e.target.value)}
                    required
                    aria-required="true"
                    data-testid="materials-import-character-id"
                  />
                ) : null}
              </div>

              <div className="me-actions">
                <button
                  type="button"
                  className="me-btn me-btn-primary"
                  disabled={busy}
                  onClick={() => void handleCite(selected)}
                >
                  {citedIds.has(selected.id) ? "已引用" : "引用到资产库"}
                </button>
                <button
                  type="button"
                  className="me-btn"
                  disabled={busy || !importProjectId}
                  onClick={() => void handleImport(selected)}
                >
                  导入到项目
                </button>
                <button
                  type="button"
                  className="me-btn"
                  onClick={() => setSelected(null)}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
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
