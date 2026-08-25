"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { canCreateProject } from "@/auth/capabilities";
import { getSystemRole } from "@/auth/roles";
import { useAuthUser } from "@/shell/useAuthUser";
import { projectWorkbenchPath } from "@/shell/nav";
import { writeCurrentProjectId } from "@/shell/current-project-context";
import { CreateProjectWizardDialog } from "@/projects/components/CreateProjectWizardDialog";
import type { ProjectFlowConfig } from "@/projects/project-flow";
import {
  WorkbenchProjectContextMenu,
  type WorkbenchProjectContextAction,
  type WorkbenchProjectContextMenuState,
} from "@/projects/workbench/WorkbenchProjectContextMenu";
import {
  PersonalBlankContextMenu,
  type PersonalBlankContextMenuState,
} from "@/projects/workbench/PersonalBlankContextMenu";
import { shouldOpenPersonalBlankContextMenu } from "@/projects/workbench/personal-blank-context";
import {
  ACTIVE_ENTERPRISE_EVENT,
  readActiveSpace,
  type ActiveSpace,
} from "@/enterprise/client-space";
import type { WorkflowProjectSummary } from "@/workflow/lib/workflow-storage";
import "@/app/app/projects/projects.css";

type StatusFilter = "all" | "in_progress" | "completed";

const STATUS_LABEL: Record<WorkflowProjectSummary["status"], string> = {
  draft: "草稿",
  generating: "生成中",
  completed: "已完成",
  failed: "失败",
};

const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "in_progress", label: "进行中" },
  { id: "completed", label: "已完成" },
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

type ProjectFlowListPageProps = {
  flow: ProjectFlowConfig;
};

export function ProjectFlowListPage({ flow }: ProjectFlowListPageProps) {
  const router = useRouter();
  const auth = useAuthUser();
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const [projects, setProjects] = useState<WorkflowProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [apiCanCreate, setApiCanCreate] = useState<boolean | null>(null);
  const [contextMenu, setContextMenu] =
    useState<WorkbenchProjectContextMenuState | null>(null);
  const [blankContextMenu, setBlankContextMenu] =
    useState<PersonalBlankContextMenuState | null>(null);
  const [activeSpace, setActiveSpace] = useState<ActiveSpace>(() =>
    readActiveSpace(),
  );
  const [renaming, setRenaming] = useState<{
    projectId: string;
    name: string;
  } | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  const allowedBySession =
    auth.status === "authenticated" && canCreateProject(auth.user);
  const canCreate =
    activeSpace.kind === "enterprise"
      ? apiCanCreate === true
      : (apiCanCreate ?? allowedBySession);
  const canEditRules =
    auth.status === "authenticated" &&
    getSystemRole(auth.user) === "SYSTEM_ADMIN";

  const reloadProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: "1",
        pageSize: "50",
        projectMode: flow.projectMode,
      });
      if (activeSpace.kind === "enterprise") {
        params.set("enterpriseId", activeSpace.enterpriseId);
      }
      if (debouncedQuery.trim()) {
        params.set("q", debouncedQuery.trim());
        params.set("pageSize", "100");
      }
      const res = await fetch(`/api/projects?${params.toString()}`, {
        cache: "no-store",
        credentials: "include",
      });
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
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [activeSpace, debouncedQuery, flow.projectMode]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
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

  useEffect(() => {
    const onSpaceChanged = (event: Event) => {
      const detail = (event as CustomEvent<ActiveSpace>).detail;
      setApiCanCreate(null);
      setActiveSpace(detail ?? readActiveSpace());
      setBlankContextMenu(null);
    };
    window.addEventListener(ACTIVE_ENTERPRISE_EVENT, onSpaceChanged);
    return () =>
      window.removeEventListener(ACTIVE_ENTERPRISE_EVENT, onSpaceChanged);
  }, []);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (filter === "in_progress") {
        return p.status === "draft" || p.status === "generating";
      }
      if (filter === "completed") {
        return p.status === "completed";
      }
      if (!debouncedQuery) return true;
      const q = debouncedQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.projectId.toLowerCase().includes(q)
      );
    });
  }, [projects, filter, debouncedQuery]);

  const openProject = useCallback(
    (projectId: string) => {
      writeCurrentProjectId(projectId, flow.kind);
      router.push(projectWorkbenchPath(projectId));
    },
    [flow.kind, router],
  );

  const handleContextAction = useCallback(
    async (action: WorkbenchProjectContextAction, projectId: string) => {
      const project = projects.find((item) => item.projectId === projectId);
      if (!project) return;
      setNote("");
      if (action === "open") {
        openProject(projectId);
        return;
      }
      if (action === "rules") {
        router.push("/app/admin?view=rules");
        return;
      }
      if (action === "rename") {
        setRenaming({ projectId, name: project.name });
        return;
      }
      if (action === "delete") {
        const confirmed = window.confirm(
          `确认删除项目「${project.name}」？此操作不可恢复。`,
        );
        if (!confirmed) return;
        try {
          const res = await fetch(
            `/api/projects/${encodeURIComponent(projectId)}`,
            { method: "DELETE", credentials: "include" },
          );
          const payload = (await res.json()) as { error?: string };
          if (!res.ok) throw new Error(payload.error ?? "删除失败");
          setProjects((prev) =>
            prev.filter((item) => item.projectId !== projectId),
          );
          setNote(`已删除项目「${project.name}」`);
        } catch (err) {
          setNote(err instanceof Error ? err.message : "删除失败");
        }
      }
    },
    [openProject, projects, router],
  );

  const submitRename = useCallback(async () => {
    if (!renaming) return;
    const nextName = renaming.name.trim();
    if (!nextName) {
      setNote("请输入项目名称");
      return;
    }
    setRenameBusy(true);
    setNote("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(renaming.projectId)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nextName }),
        },
      );
      const payload = (await res.json()) as {
        project?: { name: string };
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "重命名失败");
      const savedName = payload.project?.name ?? nextName;
      setProjects((prev) =>
        prev.map((item) =>
          item.projectId === renaming.projectId
            ? { ...item, name: savedName }
            : item,
        ),
      );
      setRenaming(null);
      setNote(`已重命名为「${savedName}」`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "重命名失败");
    } finally {
      setRenameBusy(false);
    }
  }, [renaming]);

  const onNewClick = () => {
    if (!canCreate) return;
    setBlankContextMenu(null);
    setWizardOpen(true);
  };

  const handleBlankContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    if (
      !shouldOpenPersonalBlankContextMenu({
        spaceKind: activeSpace.kind,
        target: event.target instanceof Element ? event.target : null,
      })
    ) {
      return;
    }

    event.preventDefault();
    setContextMenu(null);
    setBlankContextMenu({
      x: event.clientX,
      y: event.clientY,
    });
  };

  return (
    <div className="pm-page" onContextMenu={handleBlankContextMenu}>
      <div className="pm-inner">
        <div className="pm-hero">
          <div className="pm-hero__lead">
            <div>
              <h1>{flow.title}</h1>
              <p>{flow.subtitle}</p>
            </div>
          </div>
          <button
            ref={newBtnRef}
            type="button"
            className={`pm-new-btn${canCreate ? "" : " is-disabled"}`}
            onClick={onNewClick}
            aria-disabled={!canCreate}
            title={canCreate ? "新建项目" : "仅项目主理人可以新建项目"}
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
        {note ? <p className="pm-note">{note}</p> : null}

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
            <h2>{flow.emptyTitle}</h2>
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
                data-testid="project-management-card"
                onClick={() => openProject(project.projectId)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setBlankContextMenu(null);
                  setContextMenu({
                    projectId: project.projectId,
                    projectName: project.name,
                    canManage: true,
                    canEditRules,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
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

      <WorkbenchProjectContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onAction={(action, projectId) => {
          void handleContextAction(action, projectId);
        }}
      />

      <PersonalBlankContextMenu
        menu={blankContextMenu}
        canCreate={canCreate}
        onClose={() => setBlankContextMenu(null)}
        onCreate={onNewClick}
      />

      {renaming ? (
        <div
          className="wb-rename-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="重命名项目"
          data-testid="project-rename-dialog"
        >
          <div className="wb-rename-card">
            <h3>重命名项目</h3>
            <input
              autoFocus
              value={renaming.name}
              maxLength={80}
              disabled={renameBusy}
              onChange={(event) =>
                setRenaming((prev) =>
                  prev ? { ...prev, name: event.target.value } : prev,
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitRename();
                if (event.key === "Escape") setRenaming(null);
              }}
            />
            <div className="wb-rename-actions">
              <button
                type="button"
                className="wb-btn"
                disabled={renameBusy}
                onClick={() => setRenaming(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="wb-btn wb-btn-primary"
                disabled={renameBusy}
                onClick={() => void submitRename()}
              >
                {renameBusy ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CreateProjectWizardDialog
        open={wizardOpen}
        enterpriseId={
          activeSpace.kind === "enterprise" ? activeSpace.enterpriseId : null
        }
        defaultProjectMode={flow.projectMode}
        lockProjectMode
        requireScriptUpload={flow.kind === "full-stack"}
        listFlowKind={flow.kind}
        onClose={() => setWizardOpen(false)}
        returnFocusRef={newBtnRef}
        onAdvance={() => {
          void reloadProjects();
        }}
      />
    </div>
  );
}
