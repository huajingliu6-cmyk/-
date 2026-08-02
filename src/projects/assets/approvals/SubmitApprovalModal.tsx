"use client";

import { useEffect, useMemo, useState } from "react";
import { DesignImageLightbox } from "@/projects/assets/DesignImageLightbox";
import { getProjectAssetImageUrl } from "@/projects/assets/asset-image-url";
import type {
  ApprovalCandidateMedia,
  ApprovalCategory,
  CandidateMediaStatus,
} from "@/projects/assets/approvals/types";

type Props = {
  open: boolean;
  projectId: string;
  projectName: string;
  episodeId: string;
  episodeNumber: number;
  onClose: () => void;
  onSubmitted: (message: string) => void;
};

const CATEGORY_ORDER: ApprovalCategory[] = ["character", "scene", "prop"];
const CATEGORY_LABEL: Record<ApprovalCategory, string> = {
  character: "人物图片",
  scene: "场景图片",
  prop: "道具图片",
};

const STATUS_LABEL: Record<CandidateMediaStatus, string> = {
  submittable: "可提交",
  pending_approval: "待审批",
  approved: "已审批",
  in_library: "已入库",
};

export function SubmitApprovalModal({
  open,
  projectId,
  projectName,
  episodeId,
  episodeNumber,
  onClose,
  onSubmitted,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<ApprovalCandidateMedia[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError("");
      setSelected(new Set());
    });
    void (async () => {
      try {
        const res = await fetch(
          `/api/workspace/projects/${encodeURIComponent(projectId)}/asset-approvals?episodeId=${encodeURIComponent(episodeId)}`,
        );
        const payload = (await res.json()) as {
          candidates?: ApprovalCandidateMedia[];
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error ?? "加载候选图片失败");
        if (!cancelled) setCandidates(payload.candidates ?? []);
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
  }, [open, projectId, episodeId]);

  const byCategory = useMemo(() => {
    const map: Record<ApprovalCategory, ApprovalCandidateMedia[]> = {
      character: [],
      scene: [],
      prop: [],
    };
    for (const c of candidates) {
      map[c.category].push(c);
    }
    return map;
  }, [candidates]);

  const submittableCount = candidates.filter(
    (c) => c.status === "submittable",
  ).length;

  const toggle = (mediaId: string, status: CandidateMediaStatus) => {
    if (status !== "submittable") return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(
        `/api/workspace/projects/${encodeURIComponent(projectId)}/asset-approvals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `submit-${episodeId}-${[...selected].sort().join(",")}`,
          },
          body: JSON.stringify({
            episodeId,
            generatedMediaIds: [...selected],
          }),
        },
      );
      const payload = (await res.json()) as {
        error?: string;
        counts?: { total: number };
      };
      if (!res.ok) throw new Error(payload.error ?? "提交失败");
      onSubmitted(
        `已提交 ${payload.counts?.total ?? selected.size} 张素材审批，等待主理人处理。`,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="ead-modal-backdrop"
        role="presentation"
        onClick={onClose}
        data-testid="submit-approval-backdrop"
      >
        <div
          className="ead-modal ead-modal--wide ead-approval-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-approval-title"
          onClick={(e) => e.stopPropagation()}
          data-testid="submit-approval-modal"
        >
          <header className="ead-modal__head">
            <div>
              <h2 id="submit-approval-title">提交审批素材</h2>
              <p className="ead-approval-modal__sub">
                {projectName} · 第 {episodeNumber} 集 · 可提交 {submittableCount}{" "}
                张 · 已选择 {selected.size} 张
              </p>
            </div>
            <button type="button" className="amw-btn" onClick={onClose}>
              关闭
            </button>
          </header>

          {loading ? (
            <p className="amw-note">加载中…</p>
          ) : candidates.length === 0 ? (
            <p className="amw-note" data-testid="submit-approval-empty">
              当前没有可提交审批的已生成图片
            </p>
          ) : (
            <div
              className="ead-approval-columns"
              data-testid="submit-approval-columns"
            >
              {CATEGORY_ORDER.map((cat) => (
                <section key={cat} className="ead-approval-col">
                  <h3>
                    {CATEGORY_LABEL[cat]}（{byCategory[cat].length}）
                  </h3>
                  <div className="ead-approval-col__scroll">
                    {byCategory[cat].length === 0 ? (
                      <p className="amw-note">暂无</p>
                    ) : (
                      byCategory[cat].map((c) => {
                        const src = getProjectAssetImageUrl(
                          projectId,
                          c.generatedMediaId,
                        );
                        const disabled = c.status !== "submittable";
                        return (
                          <article
                            key={c.generatedMediaId}
                            className="ead-approval-card"
                            data-testid={`submit-candidate-${c.generatedMediaId}`}
                          >
                            <button
                              type="button"
                              className="ead-approval-card__thumb"
                              onClick={() => setLightboxSrc(src)}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={src} alt={c.assetName} />
                            </button>
                            <div className="ead-approval-card__meta">
                              <strong>{c.assetName}</strong>
                              <span>
                                {c.generatedAt
                                  ? new Date(c.generatedAt).toLocaleString()
                                  : "—"}
                              </span>
                              <span
                                data-testid={`candidate-status-${c.generatedMediaId}`}
                              >
                                {STATUS_LABEL[c.status]}
                              </span>
                            </div>
                            <label className="ead-approval-card__check">
                              <input
                                type="checkbox"
                                checked={selected.has(c.generatedMediaId)}
                                disabled={disabled}
                                onChange={() =>
                                  toggle(c.generatedMediaId, c.status)
                                }
                                data-testid={`submit-check-${c.generatedMediaId}`}
                              />
                              选择
                            </label>
                          </article>
                        );
                      })
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}

          {error ? (
            <p className="amw-note" data-testid="submit-approval-error">
              {error}
            </p>
          ) : null}

          <footer className="ead-modal__foot">
            <span data-testid="submit-approval-selected-count">
              已选择 {selected.size} 张
            </span>
            <div className="ead-modal__foot-actions">
              <button type="button" className="amw-btn" onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                disabled={selected.size === 0 || submitting}
                onClick={() => void handleSubmit()}
                data-testid="submit-approval-confirm"
              >
                {submitting ? "提交中…" : "提交审批"}
              </button>
            </div>
          </footer>
        </div>
      </div>
      <DesignImageLightbox
        src={lightboxSrc}
        onClose={() => setLightboxSrc(null)}
      />
    </>
  );
}
