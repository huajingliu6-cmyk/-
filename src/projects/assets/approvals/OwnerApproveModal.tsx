"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { DesignImageLightbox } from "@/projects/assets/DesignImageLightbox";
import { getProjectAssetImageUrl } from "@/projects/assets/asset-image-url";
import { VoicePreviewButton } from "@/projects/assets/VoicePreviewButton";
import type {
  ApprovalCategory,
  AssetApprovalItem,
  AssetApprovalSubmission,
  ApprovalSubmissionStatus,
} from "@/projects/assets/approvals/types";
import type { AudioAsset } from "@/projects/assets/types";

type Props = {
  open: boolean;
  projectId: string;
  projectName: string;
  submissionId: string;
  episodeNumber?: number;
  onClose: () => void;
  onApproved?: (message: string) => void;
};

const CATEGORY_ORDER: ApprovalCategory[] = ["character", "scene", "prop"];
const CATEGORY_LABEL: Record<ApprovalCategory, string> = {
  character: "人物图片",
  scene: "场景图片",
  prop: "道具图片",
};

const STATUS_LABEL: Record<ApprovalSubmissionStatus, string> = {
  pending: "待审批",
  partially_approved: "部分处理",
  approved: "已通过",
  rejected: "已驳回",
};

function itemStatusLabel(item: AssetApprovalItem): string {
  if (item.status === "approved") return "已通过";
  if (item.status === "rejected") return "已驳回";
  return "待审批";
}

export function OwnerApproveModal({
  open,
  projectId,
  projectName,
  submissionId,
  episodeNumber,
  onClose,
  onApproved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submission, setSubmission] = useState<AssetApprovalSubmission | null>(
    null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [submitterLabel, setSubmitterLabel] = useState("");
  const [audios, setAudios] = useState<AudioAsset[]>([]);

  useEffect(() => {
    if (!open || !submissionId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError("");
      }
    });
    void (async () => {
      try {
        const [approvalRes, assetsRes] = await Promise.all([
          fetch(
            `/api/projects/${encodeURIComponent(projectId)}/asset-approvals/${encodeURIComponent(submissionId)}`,
          ),
          fetch(`/api/projects/${encodeURIComponent(projectId)}/assets-draft`),
        ]);
        const payload = (await approvalRes.json()) as {
          submission?: AssetApprovalSubmission;
          error?: string;
        };
        if (!approvalRes.ok) {
          throw new Error(payload.error ?? "加载审批单失败");
        }
        if (cancelled) return;
        setSubmission(payload.submission ?? null);
        setSelected(new Set());
        setSubmitterLabel(payload.submission?.submittedByUserId ?? "");
        if (assetsRes.ok) {
          const assetsPayload = (await assetsRes.json()) as {
            draft?: { audios?: AudioAsset[] };
          };
          setAudios(assetsPayload.draft?.audios ?? []);
        } else {
          setAudios([]);
        }
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
  }, [open, projectId, submissionId]);

  const byCategory = useMemo(() => {
    const map: Record<ApprovalCategory, AssetApprovalItem[]> = {
      character: [],
      scene: [],
      prop: [],
    };
    for (const item of submission?.items ?? []) {
      map[item.category].push(item);
    }
    return map;
  }, [submission]);

  const pendingCount =
    submission?.items.filter((i) => i.status === "pending").length ?? 0;
  const approvedCount =
    submission?.items.filter((i) => i.status === "approved").length ?? 0;
  const rejectedCount =
    submission?.items.filter((i) => i.status === "rejected").length ?? 0;

  const toggle = (item: AssetApprovalItem) => {
    if (item.status !== "pending") return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const handleApprove = async () => {
    if (selected.size === 0 || approving) return;
    setApproving(true);
    setError("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/asset-approvals/${encodeURIComponent(submissionId)}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds: [...selected] }),
        },
      );
      const payload = (await res.json()) as {
        submission?: AssetApprovalSubmission;
        error?: string;
        approvedCount?: number;
      };
      if (!res.ok) throw new Error(payload.error ?? "审批失败");
      if (payload.submission) setSubmission(payload.submission);
      setSelected(new Set());
      onApproved?.(
        `已通过 ${selected.size} 张素材审批。当前状态：${
          payload.submission
            ? STATUS_LABEL[payload.submission.status]
            : "已更新"
        }`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "审批失败");
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async (item: AssetApprovalItem) => {
    if (item.status !== "pending" || rejectingId) return;
    setRejectingId(item.id);
    setError("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/asset-approvals/${encodeURIComponent(submissionId)}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds: [item.id] }),
        },
      );
      const payload = (await res.json()) as {
        submission?: AssetApprovalSubmission;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "驳回失败");
      if (payload.submission) setSubmission(payload.submission);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      onApproved?.(
        `已驳回「${item.assetNameSnapshot}」，该素材不会进入项目管理与资产库。`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "驳回失败");
    } finally {
      setRejectingId(null);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="ead-modal-backdrop"
        role="presentation"
        onClick={onClose}
        data-testid="owner-approve-backdrop"
      >
        <div
          className="ead-modal ead-modal--wide ead-approval-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="owner-approve-title"
          onClick={(e) => e.stopPropagation()}
          data-testid="owner-approve-modal"
        >
          <header className="ead-modal__head">
            <div>
              <h2 id="owner-approve-title">素材审批</h2>
              <p className="ead-approval-modal__sub">
                {projectName}
                {episodeNumber != null ? ` · 第 ${episodeNumber} 集` : ""} ·
                提交人 {submitterLabel} · 提交时间{" "}
                {submission?.submittedAt
                  ? new Date(submission.submittedAt).toLocaleString()
                  : "—"}{" "}
                · 待审批 {pendingCount} · 已审批 {approvedCount} · 已驳回{" "}
                {rejectedCount} · 状态{" "}
                {submission ? STATUS_LABEL[submission.status] : "—"}
              </p>
            </div>
            <button type="button" className="amw-btn" onClick={onClose}>
              关闭
            </button>
          </header>

          {loading ? (
            <p className="amw-note">加载中…</p>
          ) : !submission ? (
            <p className="amw-note">未找到审批单</p>
          ) : (
            <div
              className="ead-approval-columns"
              data-testid="owner-approve-columns"
            >
              {CATEGORY_ORDER.map((cat) => (
                <section key={cat} className="ead-approval-col">
                  <h3>
                    {CATEGORY_LABEL[cat]}（{byCategory[cat].length}）
                  </h3>
                  <div className="ead-approval-col__scroll">
                    {byCategory[cat].map((item) => {
                      const src = getProjectAssetImageUrl(
                        projectId,
                        item.generatedMediaId,
                      );
                      const approved = item.status === "approved";
                      const rejected = item.status === "rejected";
                      const pending = item.status === "pending";
                      return (
                        <article
                          key={item.id}
                          className={`ead-approval-card${
                            rejected ? " is-rejected" : ""
                          }`}
                          data-testid={`approve-item-${item.id}`}
                        >
                          <div className="ead-approval-card__thumb-wrap">
                            <button
                              type="button"
                              className="ead-approval-card__thumb"
                              onClick={() => setLightboxSrc(src)}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={src} alt={item.assetNameSnapshot} />
                            </button>
                            {pending ? (
                              <button
                                type="button"
                                className="ead-approval-card__reject"
                                title="驳回，不进入项目管理与资产库"
                                data-testid={`approve-reject-${item.id}`}
                                disabled={rejectingId === item.id || approving}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleReject(item);
                                }}
                              >
                                <X className="h-3.5 w-3.5" aria-hidden />
                                <span className="sr-only">驳回</span>
                              </button>
                            ) : null}
                          </div>
                          <div className="ead-approval-card__meta">
                            <strong>{item.assetNameSnapshot}</strong>
                            <span>
                              {item.generatedAtSnapshot
                                ? new Date(
                                    item.generatedAtSnapshot,
                                  ).toLocaleString()
                                : "—"}
                            </span>
                            <span>{itemStatusLabel(item)}</span>
                            {item.category === "character" &&
                            item.voiceIdSnapshot ? (
                              <div className="ead-approval-card__voice">
                                <span className="ead-approval-card__voice-name">
                                  音色：{item.voiceNameSnapshot || "已绑定"}
                                </span>
                                <VoicePreviewButton
                                  projectId={projectId}
                                  voiceId={item.voiceIdSnapshot}
                                  audios={audios}
                                  className="amw-btn ead-approval-card__voice-preview"
                                  testId={`approve-voice-preview-${item.id}`}
                                />
                              </div>
                            ) : null}
                          </div>
                          <label className="ead-approval-card__check">
                            <input
                              type="checkbox"
                              checked={approved || selected.has(item.id)}
                              disabled={!pending}
                              onChange={() => toggle(item)}
                              data-testid={`approve-check-${item.id}`}
                            />
                            {approved
                              ? "已通过"
                              : rejected
                                ? "已驳回"
                                : "通过"}
                          </label>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          {error ? (
            <p className="amw-note" data-testid="owner-approve-error">
              {error}
            </p>
          ) : null}

          <footer className="ead-modal__foot">
            <span data-testid="owner-approve-selected-count">
              已选择 {selected.size} 张
            </span>
            <div className="ead-modal__foot-actions">
              <button type="button" className="amw-btn" onClick={onClose}>
                关闭
              </button>
              <button
                type="button"
                className="amw-btn amw-btn-primary"
                disabled={selected.size === 0 || approving || Boolean(rejectingId)}
                onClick={() => void handleApprove()}
                data-testid="owner-approve-confirm"
              >
                {approving ? "审批中…" : "确认审批"}
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
