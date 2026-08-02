"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { APP_PROJECTS_PATH, workflowEditorPath } from "@/shell/nav";
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

  const scriptHref =
    data?.project.creationSource === "story"
      ? `/app/projects/${encodeURIComponent(projectId)}/story`
      : `/app/projects/${encodeURIComponent(projectId)}/script`;

  return (
    <div className="wb-page" data-testid="project-management-page">
      <div className="wb-inner">
        <div className="wb-topnav">
          <Link className="wb-link" href={APP_PROJECTS_PATH}>
            返回项目管理
          </Link>
        </div>

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

            <section className="wb-stages" aria-label="创作流程">
              <Link className="wb-stage" href={scriptHref} data-testid="stage-script">
                <div className="wb-stage__head">
                  <h2>剧本创作</h2>
                </div>
                <p>创编故事或上传剧本并完成分集。</p>
                <span className="wb-stage__action">进入剧本创作</span>
              </Link>
              <Link
                className="wb-stage"
                href={`/app/projects/${encodeURIComponent(projectId)}/assets/design`}
                data-testid="stage-assets"
              >
                <div className="wb-stage__head">
                  <h2>项目资产</h2>
                </div>
                <p>管理角色、场景、道具与音频。</p>
                <span className="wb-stage__action">进入项目资产</span>
              </Link>
              <Link
                className="wb-stage"
                href={`/app/projects/${encodeURIComponent(projectId)}/storyboard`}
                data-testid="stage-storyboard"
              >
                <div className="wb-stage__head">
                  <h2>分镜创作</h2>
                </div>
                <p>确认剧本、匹配资产并生成文字分镜。</p>
                <span className="wb-stage__action">进入分镜创作</span>
              </Link>
              {data.project.projectMode === "canvas" ? (
                <Link
                  className="wb-stage is-video"
                  href={workflowEditorPath(projectId)}
                  data-testid="stage-video"
                >
                  <div className="wb-stage__head">
                    <h2>视频制作</h2>
                  </div>
                  <p>进入视频制作画布。</p>
                  <span className="wb-stage__action">进入视频制作画布</span>
                </Link>
              ) : null}
            </section>

            <ProjectMembersPanel projectId={projectId} />
          </>
        ) : null}
      </div>
    </div>
  );
}
