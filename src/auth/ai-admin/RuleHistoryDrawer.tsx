"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { History, X } from "lucide-react";
import { readJson } from "@/auth/ai-admin/shared";
import type { TaskRulePublishedVersion } from "@/auth/ai-admin/types";

type Props = {
  open: boolean;
  capabilityId: string;
  capabilityLabel: string;
  onClose: () => void;
  onRollback: (version: number) => Promise<void>;
};

export function RuleHistoryDrawer({
  open,
  capabilityId,
  capabilityLabel,
  onClose,
  onRollback,
}: Props) {
  const [versions, setVersions] = useState<TaskRulePublishedVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyVersion, setBusyVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `/api/admin/ai-task-rules/${encodeURIComponent(capabilityId)}/versions`,
        );
        const payload = await readJson<{
          versions?: TaskRulePublishedVersion[];
          error?: string;
        }>(res);
        if (!res.ok) throw new Error(payload.error ?? "加载版本历史失败");
        if (!cancelled) setVersions(payload.versions ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载版本历史失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, capabilityId]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2100] flex justify-end bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-zinc-700 bg-zinc-950 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${capabilityLabel} 规则历史`}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <History className="h-4 w-4 text-amber-300" />
            规则版本历史
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="mb-3 text-[11px] text-zinc-500">{capabilityLabel}</p>
          {loading ? (
            <div className="text-xs text-zinc-500">加载中…</div>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          ) : null}
          {!loading && !error && versions.length === 0 ? (
            <div className="text-xs text-zinc-500">暂无已发布版本</div>
          ) : null}
          <ul className="space-y-2">
            {versions.map((v) => (
              <li
                key={v.version}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-100">
                    v{v.version}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {new Date(v.publishedAt).toLocaleString()}
                  </span>
                </div>
                <div className="mb-2 text-[10px] text-zinc-500">
                  {v.sourceType}
                  {v.sourceFileName ? ` · ${v.sourceFileName}` : ""}
                  {v.rolledBackFromVersion
                    ? ` · 自 v${v.rolledBackFromVersion} 回滚`
                    : ""}
                </div>
                <pre className="mb-2 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-zinc-950/80 p-2 text-[10px] text-zinc-400">
                  {v.content.slice(0, 400)}
                  {v.content.length > 400 ? "…" : ""}
                </pre>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                  disabled={busyVersion === v.version}
                  onClick={() => {
                    setBusyVersion(v.version);
                    void onRollback(v.version).finally(() =>
                      setBusyVersion(null),
                    );
                  }}
                >
                  {busyVersion === v.version ? "回滚中…" : "回滚到此版本"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  );
}
