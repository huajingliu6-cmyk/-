"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import "@/projects/workbench/workbench.css";

type StageItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  enabled: boolean;
  actionLabel: string;
};

type WorkspaceProjectPayload = {
  project: {
    projectId: string;
    name: string;
    status: string;
    creationSource: string;
    projectMode: string;
    updatedAt: string;
  };
  effectiveRole: string;
  stages: StageItem[];
};

export default function WorkspaceProjectPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [data, setData] = useState<WorkspaceProjectPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/workspace/projects/${encodeURIComponent(projectId)}`,
        );
        const payload = (await res.json()) as WorkspaceProjectPayload & {
          error?: string;
        };
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
    <div className="wb-page" data-testid="workspace-project-page">
      <div className="wb-inner">
        {loading ? (
          <p className="wb-muted">加载中…</p>
        ) : error ? (
          <p className="wb-error">{error}</p>
        ) : data ? (
          <>
            <header className="wb-hero">
              <div>
                <h1>工作台项目</h1>
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

            <section className="wb-stages" aria-label="工作台功能">
              {data.stages.map((stage) => (
                <Link
                  key={stage.id}
                  className="wb-stage"
                  href={stage.href}
                  data-testid={`workspace-stage-${stage.id}`}
                >
                  <div className="wb-stage__head">
                    <h2>{stage.title}</h2>
                  </div>
                  <p>{stage.description}</p>
                  <span className="wb-stage__action">{stage.actionLabel}</span>
                </Link>
              ))}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
