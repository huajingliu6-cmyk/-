"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyInvalidStoryboardRefsApi,
  previewInvalidStoryboardRefsApi,
  scanInvalidStoryboardRefsApi,
} from "@/projects/storyboard/api-client";
import type { PickerAsset } from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import type {
  InvalidRefIssue,
  InvalidRefMediaSelection,
  InvalidRefPreview,
  InvalidRefScanResult,
  InvalidRefScope,
} from "@/projects/storyboard/invalid-refs/types";

type Props = {
  open: boolean;
  projectId: string;
  context: "management" | "workspace";
  episodeId: string | null;
  assets: PickerAsset[];
  initialScope?: InvalidRefScope;
  focusShotId?: string | null;
  onClose: () => void;
  onApplied: (rescan: InvalidRefScanResult) => void;
};

function mediaThumb(
  assets: PickerAsset[],
  assetId: string,
  mediaId: string | null,
): string | null {
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) return null;
  if (mediaId) {
    return (
      asset.mediaOptions?.find((m) => m.mediaId === mediaId)?.thumbUrl ??
      asset.thumbUrl ??
      null
    );
  }
  return asset.thumbUrl ?? null;
}

export function InvalidRefsRepairDialog({
  open,
  projectId,
  context,
  episodeId,
  assets,
  initialScope = "episode",
  focusShotId,
  onClose,
  onApplied,
}: Props) {
  const [scope, setScope] = useState<InvalidRefScope>(initialScope);
  const [scan, setScan] = useState<InvalidRefScanResult | null>(null);
  const [preview, setPreview] = useState<InvalidRefPreview | null>(null);
  const [selections, setSelections] = useState<InvalidRefMediaSelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"scan" | "preview">("scan");

  const selectionMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of selections) map.set(row.issueId, row.mediaId);
    return map;
  }, [selections]);

  const issues = useMemo(
    () => scan?.episodes.flatMap((ep) => ep.issues) ?? [],
    [scan],
  );

  const visibleIssues = useMemo(() => {
    if (!focusShotId) return issues;
    const focused = issues.filter((i) => i.shotId === focusShotId);
    return focused.length > 0 ? focused : issues;
  }, [issues, focusShotId]);

  useEffect(() => {
    if (!open) return;
    setScope(initialScope);
    setStep("scan");
    setPreview(null);
    setSelections([]);
    setError("");
    setLoading(true);
    void scanInvalidStoryboardRefsApi(projectId, {
      scope: initialScope,
      episodeId,
      context,
    })
      .then((res) => setScan(res.scan))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "扫描失败"),
      )
      .finally(() => setLoading(false));
  }, [open, projectId, context, episodeId, initialScope]);

  async function rescan(nextScope: InvalidRefScope) {
    setScope(nextScope);
    setStep("scan");
    setPreview(null);
    setSelections([]);
    setError("");
    setLoading(true);
    try {
      const res = await scanInvalidStoryboardRefsApi(projectId, {
        scope: nextScope,
        episodeId,
        context,
      });
      setScan(res.scan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "扫描失败");
    } finally {
      setLoading(false);
    }
  }

  function setMediaForIssue(issue: InvalidRefIssue, mediaId: string) {
    setSelections((prev) => {
      const rest = prev.filter((row) => row.issueId !== issue.issueId);
      return [...rest, { issueId: issue.issueId, mediaId }];
    });
    setPreview(null);
    setStep("scan");
  }

  async function buildPreview() {
    setError("");
    setLoading(true);
    try {
      const res = await previewInvalidStoryboardRefsApi(projectId, {
        scope,
        episodeId,
        mediaSelections: selections,
        context,
      });
      setScan(res.scan);
      setPreview(res.preview);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "预览失败");
    } finally {
      setLoading(false);
    }
  }

  async function confirmApply() {
    if (!preview?.canConfirm || !preview.previewId || !preview.planDigest) return;
    setConfirming(true);
    setError("");
    try {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const res = await applyInvalidStoryboardRefsApi(projectId, {
            previewId: preview.previewId,
            planDigest: preview.planDigest,
            confirm: true,
            context,
          });
          onApplied(res.rescan);
          setScan(res.rescan);
          setPreview(null);
          setSelections([]);
          setStep("scan");
          return;
        } catch (err) {
          lastError = err;
          const code =
            err && typeof err === "object" && "code" in err
              ? String((err as { code?: string }).code ?? "")
              : "";
          if (code === "APPLY_IN_PROGRESS" && attempt < 4) {
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
            continue;
          }
          throw err;
        }
      }
      throw lastError;
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code ?? "")
          : "";
      if (code === "PREVIEW_STALE") {
        setError(
          `${err instanceof Error ? err.message : "预览已过期"}。请重新扫描并生成预览。`,
        );
        setStep("scan");
        setPreview(null);
      } else if (code === "APPLY_IN_PROGRESS") {
        setError(
          err instanceof Error
            ? err.message
            : "修复正在提交中，请稍后用同一预览重试。",
        );
      } else if (code === "CONSISTENCY_GUARANTEE_UNAVAILABLE") {
        setError(
          err instanceof Error
            ? err.message
            : "当前部署无法安全确认修复（跨实例一致性保证不可用）。",
        );
      } else {
        setError(err instanceof Error ? err.message : "保存失败");
      }
    } finally {
      setConfirming(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="sbw-modal-backdrop"
      data-testid="invalid-refs-repair-dialog"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!confirming && !loading) onClose();
      }}
    >
      <div
        className="sbw-modal"
        style={{ maxWidth: 720, width: "min(720px, 96vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sbw-modal__head">
          <h3>修复失效资产引用</h3>
          <button
            type="button"
            className="sbw-btn"
            disabled={confirming}
            onClick={onClose}
          >
            关闭
          </button>
        </header>

        <div className="sbw-modal__body">
          <div className="sbw-actions" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={`sbw-btn${scope === "episode" ? " is-primary" : ""}`}
              data-testid="invalid-refs-scope-episode"
              disabled={loading || confirming}
              onClick={() => void rescan("episode")}
            >
              当前剧集
            </button>
            <button
              type="button"
              className={`sbw-btn${scope === "project" ? " is-primary" : ""}`}
              data-testid="invalid-refs-scope-project"
              disabled={loading || confirming}
              onClick={() => void rescan("project")}
            >
              全部剧集
            </button>
          </div>

          {scan ? (
            <p className="sbw-note" data-testid="invalid-refs-summary">
              扫描 {scan.scannedEpisodeCount} 集 / {scan.scannedShotCount}{" "}
              镜，发现 {scan.issueCount} 项失效引用
              {scan.pendingManualSelectionCount > 0
                ? `（待逐镜选择 ${scan.pendingManualSelectionCount}）`
                : ""}
            </p>
          ) : null}

          {error ? (
            <p className="sbw-error" data-testid="invalid-refs-error">
              {error}
            </p>
          ) : null}

          {loading && !scan ? <p className="sbw-note">扫描中…</p> : null}

          {step === "scan" ? (
            <div data-testid="invalid-refs-issue-list">
              {scan?.episodes.map((ep) => (
                <section key={ep.episodeId} style={{ marginBottom: 16 }}>
                  <h4>
                    第 {ep.episodeNumber ?? "?"} 集
                    {ep.episodeTitle ? ` · ${ep.episodeTitle}` : ""}
                    <span className="sbw-note">
                      {" "}
                      （{ep.issueCount} 项 / 待选{" "}
                      {ep.pendingManualSelectionCount}）
                    </span>
                  </h4>
                  <ul className="sbw-confirm-list">
                    {ep.issues
                      .filter((issue) =>
                        focusShotId
                          ? visibleIssues.some((v) => v.issueId === issue.issueId)
                          : true,
                      )
                      .map((issue) => (
                        <li
                          key={issue.issueId}
                          data-testid={`invalid-ref-issue-${issue.reason}`}
                        >
                          <div>
                            <strong>
                              镜头 {String(issue.shotNumber).padStart(2, "0")}
                            </strong>{" "}
                            · <span className="sbw-badge">{issue.label}</span>
                            <div className="sbw-note">
                              {issue.assetName ?? issue.assetId}
                              {issue.mediaId ? ` · 媒体 ${issue.mediaId}` : ""}
                            </div>
                          </div>
                          {issue.requiresManualMediaSelection ? (
                            <div style={{ marginTop: 8 }}>
                              <p className="sbw-note">
                                需要逐镜选择（禁止自动切换主图/最近造型）
                              </p>
                              <div className="sbw-actions">
                                {issue.selectableMediaIds.length === 0 ? (
                                  <span className="sbw-error">
                                    当前无可用认证媒体
                                  </span>
                                ) : (
                                  issue.selectableMediaIds.map((mediaId) => {
                                    const selected =
                                      selectionMap.get(issue.issueId) === mediaId;
                                    const thumb = mediaThumb(
                                      assets,
                                      issue.assetId,
                                      mediaId,
                                    );
                                    return (
                                      <button
                                        key={mediaId}
                                        type="button"
                                        className={`sbw-btn${selected ? " is-primary" : ""}`}
                                        data-testid={`invalid-ref-pick-${issue.issueId}-${mediaId}`}
                                        onClick={() =>
                                          setMediaForIssue(issue, mediaId)
                                        }
                                      >
                                        {thumb ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img
                                            src={thumb}
                                            alt=""
                                            width={28}
                                            height={28}
                                            style={{
                                              verticalAlign: "middle",
                                              marginRight: 6,
                                              borderRadius: 4,
                                            }}
                                          />
                                        ) : null}
                                        {mediaId}
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          ) : null}
                          {issue.reason === "NAME_CHANGED" ? (
                            <div className="sbw-note" style={{ marginTop: 6 }}>
                              名称：{(issue.oldNames ?? []).join(" / ")} →{" "}
                              {issue.newName}
                            </div>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
              {scan && scan.issueCount === 0 ? (
                <p className="sbw-note" data-testid="invalid-refs-empty">
                  未发现失效引用
                </p>
              ) : null}
            </div>
          ) : null}

          {step === "preview" && preview ? (
            <div data-testid="invalid-refs-preview">
              <p className="sbw-note">
                预览将修改 {preview.shotChanges.length} 个镜头。取消或返回不会写入。
              </p>
              {!preview.canConfirm ? (
                <p className="sbw-error" data-testid="invalid-refs-preview-blocked">
                  {preview.blockingReason}
                </p>
              ) : null}
              <ul className="sbw-confirm-list">
                {preview.shotChanges.map((change) => (
                  <li key={`${change.episodeId}:${change.shotId}`}>
                    <strong>
                      镜头 {String(change.shotNumber).padStart(2, "0")}
                    </strong>
                    {change.requiresManualMediaSelection &&
                    change.unresolvedIssueIds.length > 0 ? (
                      <div className="sbw-badge">需要逐镜选择</div>
                    ) : null}
                    {Object.entries(change.assetMediaIdPatches).map(
                      ([assetId, mediaId]) => (
                        <div key={assetId} className="sbw-note">
                          媒体：{assetId} → {mediaId || "（清除）"}
                        </div>
                      ),
                    )}
                    {change.unlinkAssetIds?.map((assetId) => (
                      <div key={`u-${assetId}`} className="sbw-note">
                        解绑资产：{assetId}
                      </div>
                    ))}
                    {change.nameReplacements.map((rep, idx) => (
                      <div
                        key={`${rep.field}-${idx}`}
                        data-testid="invalid-refs-name-diff"
                      >
                        <div>
                          字段 <code>{rep.field}</code>
                        </div>
                        <div className="sbw-note">旧：{rep.before}</div>
                        <div className="sbw-note">新：{rep.after}</div>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <footer className="sbw-modal__foot sbw-actions">
          {step === "preview" ? (
            <button
              type="button"
              className="sbw-btn"
              disabled={confirming}
              onClick={() => setStep("scan")}
            >
              返回
            </button>
          ) : null}
          <button
            type="button"
            className="sbw-btn"
            disabled={confirming || loading}
            onClick={onClose}
          >
            取消
          </button>
          {step === "scan" ? (
            <button
              type="button"
              className="sbw-btn is-primary"
              data-testid="invalid-refs-build-preview"
              disabled={loading || confirming || !scan || scan.issueCount === 0}
              onClick={() => void buildPreview()}
            >
              生成修复预览
            </button>
          ) : (
            <button
              type="button"
              className="sbw-btn is-primary"
              data-testid="invalid-refs-confirm-apply"
              disabled={
                confirming || loading || !preview?.canConfirm
              }
              onClick={() => void confirmApply()}
            >
              {confirming ? "保存中…" : "确认保存修复"}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
