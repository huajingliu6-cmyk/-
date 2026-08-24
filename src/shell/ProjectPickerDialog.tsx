"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, X } from "lucide-react";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import { writeCurrentProjectId } from "@/shell/current-project-context";
import "@/shell/project-picker-dialog.css";

type ProjectOption = {
  projectId: string;
  name: string;
};

type Props = {
  open: boolean;
  title?: string;
  description?: string;
  onClose: () => void;
  onSelect: (project: ProjectOption) => void;
  checkVideoAccess?: boolean;
  createProjectHref?: string;
};

export function ProjectPickerDialog({
  open,
  title = "选择项目",
  description = "请选择一个有画布访问权限的项目。",
  onClose,
  onSelect,
  checkVideoAccess = true,
  createProjectHref,
}: Props) {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/projects?pageSize=100", {
        credentials: "include",
      });
      const data = await parseResponseJson<{
        projects?: Array<{ projectId: string; name: string }>;
        error?: string;
      }>(response);
      if (!response.ok) {
        throw new Error(data.error || "加载项目失败");
      }
      setProjects(
        (data.projects ?? []).map((project) => ({
          projectId: project.projectId,
          name: project.name,
        })),
      );
    } catch (loadError) {
      setProjects([]);
      setError(
        loadError instanceof Error ? loadError.message : "加载项目失败",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadProjects();
  }, [loadProjects, open]);

  const handleSelect = async (project: ProjectOption) => {
    if (checkingId) return;
    setError(null);
    if (!checkVideoAccess) {
      writeCurrentProjectId(project.projectId);
      onSelect(project);
      return;
    }

    setCheckingId(project.projectId);
    try {
      const response = await fetch(
        `/api/workspace/projects/${encodeURIComponent(project.projectId)}/video-access`,
        { credentials: "include" },
      );
      if (!response.ok) {
        const data = await parseResponseJson<{ error?: string }>(response, {
          allowEmpty: true,
        });
        throw new Error(data?.error || "无权访问该项目的视频画布");
      }
      writeCurrentProjectId(project.projectId);
      onSelect(project);
    } catch (selectError) {
      setError(
        selectError instanceof Error
          ? selectError.message
          : "无权访问该项目的视频画布",
      );
    } finally {
      setCheckingId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="project-picker-dialog"
      data-testid="project-picker-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="project-picker-dialog__backdrop"
        aria-label="关闭"
        onClick={onClose}
      />
      <div className="project-picker-dialog__panel">
        <header className="project-picker-dialog__header">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button
            type="button"
            className="project-picker-dialog__close"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        {error ? <p className="project-picker-dialog__error">{error}</p> : null}

        <div className="project-picker-dialog__body">
          {loading ? (
            <p className="project-picker-dialog__empty">
              <Loader2 className="project-picker-dialog__spin" size={18} />
              正在加载项目…
            </p>
          ) : projects.length === 0 ? (
            <p className="project-picker-dialog__empty">暂无可选项目</p>
          ) : (
            <ul className="project-picker-dialog__list">
              {projects.map((project) => (
                <li key={project.projectId}>
                  <button
                    type="button"
                    className="project-picker-dialog__item"
                    disabled={checkingId != null}
                    onClick={() => void handleSelect(project)}
                  >
                    <strong>{project.name}</strong>
                    <span>{project.projectId}</span>
                    {checkingId === project.projectId ? (
                      <Loader2
                        className="project-picker-dialog__spin"
                        size={14}
                      />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {createProjectHref ? (
          <footer className="project-picker-dialog__footer">
            <Link href={createProjectHref} className="hub-btn hub-btn--glass">
              新建项目
            </Link>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
