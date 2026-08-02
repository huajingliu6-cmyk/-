"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { canCreateProject } from "@/auth/capabilities";
import { useAuthUser } from "@/shell/useAuthUser";
import { projectWorkbenchPath } from "@/shell/nav";
import { CreateProjectWizardDialog } from "@/projects/components/CreateProjectWizardDialog";
import type { WorkflowProjectSummary } from "@/workflow/lib/workflow-storage";
import "./projects.css";

type StatusFilter = "all" | WorkflowProjectSummary["status"];

const STATUS_LABEL: Record<WorkflowProjectSummary["status"], string> = {
  draft: "草稿",
  generating: "生成中",
  completed: "已完成",
  failed: "失败",
};

const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "draft", label: "草稿" },
  { id: "generating", label: "生成中" },
  { id: "completed", label: "已完成" },
  { id: "failed", label: "失败" },
];

function coverGradient(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i += 1) {
    hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  }
  return `linear-gradient(135deg, hsl(${hash % 360} 55% 28%), hsl(${(hash + 80) % 360} 60% 36%), hsl(${(hash + 160) % 360} 50% 22%))`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ProjectsPage() {
  const router = useRouter();
  const auth = useAuthUser();
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const [projects, setProjects] = useState<WorkflowProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [apiCanCreate, setApiCanCreate] = useState<boolean | null>(null);

  const allowedBySession =
    auth.status === "authenticated" && canCreateProject(auth.user);
  const canCreate = apiCanCreate ?? allowedBySession;

  const reloadProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/projects");
      const payload = (await res.json()) as {
        projects?: WorkflowProjectSummary[];
        canCreateProject?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "加载失败");
      setProjects(payload.projects ?? []);
      if (typeof payload.canCreateProject === "boolean") {
        setApiCanCreate(payload.canCreateProject);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const boot = window.setTimeout(() => {
      if (cancelled) return;
      void reloadProjects();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(boot);
    };
  }, [reloadProjects]);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (filter !== "all" && p.status !== filter) return false;
      if (!debouncedQuery) return true;
      const q = debouncedQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.projectId.toLowerCase().includes(q)
      );
    });
  }, [projects, filter, debouncedQuery]);

  const openProject = (projectId: string) => {
    router.push(projectWorkbenchPath(projectId));
  };

  const onNewClick = () => {
    if (!canCreate) return;
    setWizardOpen(true);
  };

  return (
    <div className="pm-page">
      <div className="pm-inner">
        <div className="pm-hero">
          <div>
            <h1>项目管理</h1>
            <p>管理项目、查看生成进度并继续上次创作。</p>
          </div>
          <button
            ref={newBtnRef}
            type="button"
            className={`pm-new-btn${canCreate ? "" : " is-disabled"}`}
            onClick={onNewClick}
            aria-disabled={!canCreate}
            title={
              canCreate ? "新建项目" : "仅项目主理人可以新建项目"
            }
          >
            <Plus className="h-4 w-4" aria-hidden />
            新建项目
          </button>
        </div>
        {!canCreate && auth.status === "authenticated" ? (
          <p className="pm-perm-hint">仅项目主理人可以新建项目</p>
        ) : null}

        <div className="pm-toolbar">
          <div className="pm-filters" role="tablist" aria-label="项目状态筛选">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`pm-filter${filter === item.id ? " is-active" : ""}`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="pm-tools">
            <label className="pm-search">
              <Search className="h-3.5 w-3.5 shrink-0 text-white/40" aria-hidden />
              <span className="sr-only">搜索项目</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索项目名称或 ID"
                aria-label="搜索项目"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="清除搜索"
                  onClick={() => setQuery("")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </label>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-400/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="pm-grid" aria-busy aria-label="加载项目列表">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="pm-skel">
                <div className="pm-skel__cover" />
                <div className="pm-skel__lines">
                  <div className="pm-skel__line" style={{ width: "70%" }} />
                  <div className="pm-skel__line" style={{ width: "45%" }} />
                </div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="pm-empty" aria-live="polite">
            <h2>暂无视频项目</h2>
            <p>使用页面右上角的「新建项目」开始第一次创作。</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="pm-empty" aria-live="polite">
            <h2>没有符合条件的项目</h2>
            <p>试试调整状态筛选或搜索关键词。</p>
          </div>
        ) : (
          <div className="pm-grid">
            {filtered.map((project) => (
              <button
                key={project.projectId}
                type="button"
                className="pm-card"
                onClick={() => openProject(project.projectId)}
              >
                <div className="pm-card__cover">
                  <div
                    className="pm-card__cover-inner"
                    style={{ background: coverGradient(project.projectId) }}
                    aria-hidden
                  />
                </div>
                <div className="pm-card__body">
                  <h2 className="pm-card__title">{project.name}</h2>
                  <div className="pm-card__meta">
                    <span className={`pm-badge pm-badge--${project.status}`}>
                      {STATUS_LABEL[project.status]}
                    </span>
                    <span>镜头 {project.videoShotCount}</span>
                    <span>节点 {project.nodeCount}</span>
                    <span>修订 {project.revision}</span>
                  </div>
                  <div className="pm-card__meta">
                    <span>最近修改 {formatTime(project.updatedAt)}</span>
                  </div>
                  {project.status === "generating" &&
                  project.generationProgress != null ? (
                    <div
                      className="pm-progress"
                      aria-label={`生成进度 ${Math.round(project.generationProgress)}%`}
                    >
                      <span
                        style={{
                          width: `${Math.max(0, Math.min(100, project.generationProgress))}%`,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <CreateProjectWizardDialog
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        returnFocusRef={newBtnRef}
        onAdvance={() => {
          void reloadProjects();
        }}
      />
    </div>
  );
}
