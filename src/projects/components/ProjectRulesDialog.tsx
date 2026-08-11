"use client";

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import type { ProjectPublic } from "@/projects/types";
import { PROJECT_HIGHLIGHTS_MAX_LENGTH } from "@/projects/validate-create-project";

type Props = {
  open: boolean;
  projectId: string | null;
  projectName: string;
  onClose: () => void;
  onSaved: (project: ProjectPublic) => void;
};

export function ProjectRulesDialog({
  open,
  projectId,
  projectName,
  onClose,
  onSaved,
}: Props) {
  const highlightsId = useId();
  const [highlights, setHighlights] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setHighlights("");
      setError("");
      setLoading(true);
      void fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        credentials: "include",
        cache: "no-store",
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            project?: ProjectPublic;
            error?: string;
          };
          if (!response.ok) throw new Error(payload.error ?? "加载项目规则失败");
          if (!cancelled) setHighlights(payload.project?.highlights ?? "");
        })
        .catch((reason: unknown) => {
          if (!cancelled) {
            setError(reason instanceof Error ? reason.message : "加载项目规则失败");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, saving]);

  if (!open || !projectId) return null;

  const save = async () => {
    if (saving || loading) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ highlights }),
        },
      );
      const payload = (await response.json()) as {
        project?: ProjectPublic;
        error?: string;
      };
      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? "保存项目规则失败");
      }
      onSaved(payload.project);
      onClose();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "保存项目规则失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="wb-rules-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="wb-rules-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${highlightsId}-title`}
        data-testid="project-rules-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="wb-rules-header">
          <div>
            <h3 id={`${highlightsId}-title`}>编辑项目规则</h3>
            <p>{projectName}</p>
          </div>
          <button
            type="button"
            className="wb-rules-close"
            aria-label="关闭项目规则"
            onClick={onClose}
            disabled={saving}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <label className="wb-rules-label" htmlFor={highlightsId}>
          项目要点
          <span>故事方向、人物关系、视觉风格、制作要求等</span>
        </label>
        <textarea
          id={highlightsId}
          className="wb-rules-textarea"
          value={highlights}
          onChange={(event) => setHighlights(event.target.value)}
          placeholder="填写项目要点，帮助团队保持创作方向一致"
          maxLength={PROJECT_HIGHLIGHTS_MAX_LENGTH}
          rows={8}
          disabled={loading || saving}
          autoFocus
        />
        <div className="wb-rules-meta">
          <span>{error}</span>
          <span>
            {highlights.length}/{PROJECT_HIGHLIGHTS_MAX_LENGTH}
          </span>
        </div>
        <div className="wb-rules-actions">
          <button type="button" className="wb-btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            className="wb-btn wb-btn-primary"
            onClick={() => void save()}
            disabled={loading || saving}
          >
            {loading ? "加载中…" : saving ? "保存中…" : "保存规则"}
          </button>
        </div>
      </div>
    </div>
  );
}
