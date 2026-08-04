"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectMembersPanel } from "@/projects/members/ProjectMembersPanel";
import "@/projects/workbench/workbench.css";

type ProjectPayload = {
  project: {
    projectId: string;
    name: string;
    status: string;
    creationSource: "story" | "script-upload";
    projectMode: string;
    updatedAt: string;
    highlights: string;
  };
  effectiveRole: string;
};

export default function ProjectManagementDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}`,
        );
        const payload = (await res.json()) as ProjectPayload & { error?: string };
        if (!res.ok) throw new Error(payload.error ?? "加载失败");
        if (!cancelled) {
          setData(payload);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId) {
    return (
      <div className="wb-page">
        <div className="wb-inner">
          <p className="wb-error">缺少项目 ID</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wb-page" data-testid="project-management-page">
      <div className="wb-inner">

        {loading ? (
          <p className="wb-muted">加载中…</p>
        ) : error ? (
          <p className="wb-error">{error}</p>
        ) : data ? (
          <>
            <header className="wb-hero">
              <div>
                <h1>项目工作台</h1>
                <p className="wb-project-name">{data.project.name}</p>
                <div className="wb-meta-row">
                  <span>状态：{data.project.status}</span>
                  <span>角色：{data.effectiveRole}</span>
                  <span>
                    更新：
                    {new Date(data.project.updatedAt).toLocaleString("zh-CN")}
                  </span>
                </div>
              </div>
            </header>

            <div className="wb-workspace-grid wb-workspace-grid--members-only">
              <ProjectMembersPanel projectId={projectId} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
