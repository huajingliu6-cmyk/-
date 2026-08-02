"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { workspaceProjectPath } from "@/shell/nav";
import "@/projects/workbench/workbench.css";

type WorkspaceProjectItem = {
  projectId: string;
  projectName: string;
  updatedAt: string;
  projectStatus: string;
  effectiveRole: string;
  assetSummary?: { total: number };
  workspaceFeatures: string[];
};

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

function PlatformWorkbenchBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const legacyProjectId = searchParams.get("projectId")?.trim() ?? "";

  const [projects, setProjects] = useState<WorkspaceProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!legacyProjectId) return;
    router.replace(workspaceProjectPath(legacyProjectId));
  }, [legacyProjectId, router]);

  useEffect(() => {
    if (legacyProjectId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/workspace/projects");
        const payload = (await res.json()) as {
          projects?: WorkspaceProjectItem[];
          emptyMessage?: string | null;
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error ?? "加载失败");
        if (cancelled) return;
        setProjects(payload.projects ?? []);
        setEmptyMessage(payload.emptyMessage ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [legacyProjectId]);

  if (legacyProjectId) {
    return (
      <div className="wb-page">
        <div className="wb-inner">
          <p className="wb-muted">正在打开工作台项目…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wb-page" data-testid="platform-workbench">
      <div className="wb-inner">
        <header className="wb-hero">
          <div>
            <h1>工作台</h1>
            <p>
              查看已分配或主理的项目，进入资产、分镜或视频制作。
            </p>
          </div>
        </header>

        {error ? <p className="wb-error">{error}</p> : null}

        {loading ? (
          <div className="wb-grid" aria-busy>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="wb-skel" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="wb-empty" data-testid="workspace-empty">
            <h2>
              {emptyMessage ??
                "当前没有已分配的项目，请联系系统管理员或项目主理人为你分配项目。"}
            </h2>
          </div>
        ) : (
          <div className="wb-grid">
            {projects.map((project) => (
              <button
                key={project.projectId}
                type="button"
                className="wb-card"
                data-testid="workspace-project-card"
                onClick={() =>
                  router.push(workspaceProjectPath(project.projectId))
                }
              >
                <h2>{project.projectName}</h2>
                <div className="wb-card__meta">
                  <span>{project.projectStatus}</span>
                  <span>角色 {project.effectiveRole}</span>
                  <span>
                    资产 {project.assetSummary?.total ?? 0}
                  </span>
                  <span>更新 {formatTime(project.updatedAt)}</span>
                </div>
                <span className="wb-card__cta">打开项目</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="wb-page">
          <div className="wb-inner">
            <p className="wb-muted">加载工作台…</p>
          </div>
        </div>
      }
    >
      <PlatformWorkbenchBody />
    </Suspense>
  );
}
