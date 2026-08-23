"use client";

import { useCallback, useState } from "react";
import type { ImageJobPublic } from "@/projects/assets/image-generation/useLibraryImageGenerationJob";
import { hasUsableRetrySnapshot } from "@/projects/assets/image-generation/useLibraryImageGenerationJob";
import {
  IMAGE_SOURCE_ENTRY_LABEL,
  type ImageGenerationSourceEntry,
} from "@/projects/assets/image-generation/types";

type Props = {
  projectId: string;
  context: "management" | "workspace";
  open: boolean;
  jobs: ImageJobPublic[];
  onClose: () => void;
  onRetried?: () => void;
  /** Open the asset editor for legacy jobs lacking retrySnapshot. */
  onOpenSubject?: (job: ImageJobPublic) => void;
};

function apiRoot(projectId: string, context: "management" | "workspace") {
  const enc = encodeURIComponent(projectId);
  return context === "workspace"
    ? `/api/workspace/projects/${enc}`
    : `/api/projects/${enc}`;
}

function sourceLabel(job: ImageJobPublic): string {
  const entry =
    job.sourceEntry ??
    job.params.retrySnapshot?.sourceEntry ??
    ("unknown" as ImageGenerationSourceEntry);
  return IMAGE_SOURCE_ENTRY_LABEL[entry] ?? "图片生成";
}

export function InterruptedImageJobsDialog({
  projectId,
  context,
  open,
  jobs,
  onClose,
  onRetried,
  onOpenSubject,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [replaceJobId, setReplaceJobId] = useState<string | null>(null);

  const retry = useCallback(
    async (jobId: string) => {
      setBusyId(jobId);
      setError("");
      try {
        const res = await fetch(
          `${apiRoot(projectId, context)}/assets-draft/media/jobs/${encodeURIComponent(jobId)}/retry`,
          { method: "POST", credentials: "include" },
        );
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        if (!res.ok) {
          if (payload.code === "REFERENCE_IMAGE_REQUIRED") {
            setReplaceJobId(jobId);
            setError(payload.error ?? "请重新选择参考图后再试。");
            return;
          }
          setError(payload.error ?? "重新生成失败");
          return;
        }
        onRetried?.();
      } finally {
        setBusyId(null);
      }
    },
    [context, onRetried, projectId],
  );

  const replaceAndRetry = useCallback(
    async (jobId: string, files: File[]) => {
      setBusyId(jobId);
      setError("");
      try {
        const form = new FormData();
        files.forEach((file, index) => form.set(`referenceImage[${index}]`, file));
        const replaceRes = await fetch(
          `${apiRoot(projectId, context)}/assets-draft/media/jobs/${encodeURIComponent(jobId)}/replace-reference`,
          { method: "POST", credentials: "include", body: form },
        );
        const replacePayload = (await replaceRes.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!replaceRes.ok) {
          setError(replacePayload.error ?? "替换参考图失败");
          return;
        }
        setReplaceJobId(null);
        await retry(jobId);
      } finally {
        setBusyId(null);
      }
    },
    [context, projectId, retry],
  );

  if (!open || jobs.length === 0) return null;

  return (
    <div className="amw-dialog-backdrop" role="dialog" aria-modal="true">
      <div
        className="amw-dialog image-gen-interrupted-dialog"
        data-testid="image-gen-interrupted-dialog"
      >
        <h3>有生成任务因服务中断</h3>
        <p className="amw-dialog-desc">
          不会自动重新生成。可按素材使用原参数重新生成。
        </p>
        {error ? (
          <p className="ead-error" role="alert">
            {error}
          </p>
        ) : null}
        <ul className="image-gen-interrupted-list">
          {jobs.map((job) => {
            const canOneClick = hasUsableRetrySnapshot(job);
            return (
              <li key={job.id} data-testid={`image-gen-interrupted-${job.id}`}>
                <div>
                  <strong>{job.subjectId}</strong>
                  <span> · {sourceLabel(job)}</span>
                  <div className="image-gen-interrupted-meta">
                    {job.completedAt
                      ? `中断时间 ${new Date(job.completedAt).toLocaleString()}`
                      : null}
                    <br />
                    {job.errorMessage ?? "生成服务曾中断，本次任务已中断。"}
                    {!canOneClick ? (
                      <>
                        <br />
                        旧任务缺少完整参数，请重新配置生成。
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="image-gen-interrupted-actions">
                  {!canOneClick ? (
                    <button
                      type="button"
                      className="amw-btn"
                      data-testid={`image-gen-interrupted-open-${job.id}`}
                      onClick={() => onOpenSubject?.(job)}
                    >
                      返回素材编辑
                    </button>
                  ) : replaceJobId === job.id ? (
                    <label className="amw-btn">
                      选择参考图并重试
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        hidden
                        disabled={busyId === job.id}
                        onChange={(event) => {
                          const files = Array.from(event.target.files ?? []);
                          if (files.length) void replaceAndRetry(job.id, files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  ) : (
                    <button
                      type="button"
                      className="amw-btn amw-btn-primary"
                      data-testid={`image-gen-interrupted-retry-${job.id}`}
                      disabled={busyId === job.id}
                      onClick={() => void retry(job.id)}
                    >
                      {busyId === job.id ? "提交中…" : "重新生成"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="amw-dialog-actions">
          <button type="button" className="amw-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
