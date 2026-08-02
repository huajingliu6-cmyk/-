"use client";

import { useCallback, useEffect, useState } from "react";
import {
  btnSecondaryClassName,
  InlineNotices,
  inputClassName,
  readJson,
  SectionTitle,
} from "@/auth/ai-admin/shared";

type Props = {
  active: boolean;
};

type ApprovalItemRow = {
  id: string;
  category: string;
  assetNameSnapshot: string;
  generatedMediaId: string;
  status: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  promotedAssetId: string | null;
};

type HistoryItem = {
  id: string;
  projectId: string;
  projectName: string;
  episodeId: string;
  status: string;
  submittedByUserId: string;
  submitterUsername: string;
  submitterDisplayName: string;
  approverUserId: string;
  approverUsername: string;
  approverDisplayName: string;
  itemCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  submittedAt: string;
  updatedAt: string;
  completedAt: string | null;
  items: ApprovalItemRow[];
};

type ListResponse = {
  items: HistoryItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  error?: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待审批",
  partially_approved: "部分处理",
  approved: "已通过",
  rejected: "已驳回",
};

const CATEGORY_LABELS: Record<string, string> = {
  character: "人物",
  scene: "场景",
  prop: "道具",
};

const ITEM_STATUS_LABELS: Record<string, string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function AssetApprovalsHistoryTab({ active }: Props) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage = page) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          pageSize: "20",
        });
        if (status) params.set("status", status);
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/admin/asset-approvals?${params}`);
        const data = await readJson<ListResponse>(res);
        if (!res.ok) throw new Error(data.error ?? "加载审批记录失败");
        setItems(data.items ?? []);
        setPage(data.page ?? nextPage);
        setTotalPages(data.totalPages ?? 1);
        setTotal(data.total ?? 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载审批记录失败");
      } finally {
        setLoading(false);
      }
    },
    [page, q, status],
  );

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await load(1);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload when tab activates; filters use 查询
  }, [active]);

  return (
    <div className="space-y-3" data-testid="admin-asset-approvals-history">
      <SectionTitle>素材审批记录</SectionTitle>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        后台保留全部审批提交与条目结果（通过/驳回）。用户删除消息通知不会删除此处记录。
      </p>

      <InlineNotices error={error} onDismissError={() => setError("")} />

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
        <label className="min-w-[7rem] flex-1 text-[11px] text-zinc-400">
          状态
          <select
            className={inputClassName}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">全部</option>
            {Object.entries(STATUS_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[10rem] flex-[2] text-[11px] text-zinc-400">
          搜索
          <input
            className={inputClassName}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="项目/提交人/素材名…"
          />
        </label>
        <button
          type="button"
          className={btnSecondaryClassName}
          disabled={loading}
          onClick={() => void load(1)}
        >
          {loading ? "加载中…" : "查询"}
        </button>
      </div>

      <p className="text-[11px] text-zinc-500">
        共 {total} 条 · 第 {page}/{totalPages} 页
      </p>

      <div className="space-y-2">
        {items.length === 0 && !loading ? (
          <p className="text-xs text-zinc-500">暂无审批记录</p>
        ) : null}
        {items.map((row) => {
          const expanded = expandedId === row.id;
          return (
            <article
              key={row.id}
              className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"
              data-testid={`admin-approval-row-${row.id}`}
            >
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 text-left"
                onClick={() =>
                  setExpandedId((cur) => (cur === row.id ? null : row.id))
                }
              >
                <div className="min-w-0 space-y-1">
                  <div className="truncate text-xs font-medium text-zinc-100">
                    {row.projectName}
                    <span className="ml-2 font-normal text-zinc-500">
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    提交人 {row.submitterDisplayName} · 主理人{" "}
                    {row.approverDisplayName} · 条目 {row.itemCount}（待审{" "}
                    {row.pendingCount} / 通过 {row.approvedCount} / 驳回{" "}
                    {row.rejectedCount}）
                  </div>
                  <div className="text-[11px] text-zinc-600">
                    提交 {formatTime(row.submittedAt)}
                    {row.completedAt
                      ? ` · 完成 ${formatTime(row.completedAt)}`
                      : ""}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-zinc-500">
                  {expanded ? "收起" : "详情"}
                </span>
              </button>
              {expanded ? (
                <ul className="mt-3 space-y-1.5 border-t border-zinc-800 pt-3">
                  {row.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-zinc-400"
                    >
                      <span>
                        [{CATEGORY_LABELS[item.category] ?? item.category}]{" "}
                        {item.assetNameSnapshot}
                      </span>
                      <span>
                        {ITEM_STATUS_LABELS[item.status] ?? item.status}
                        {item.promotedAssetId ? " · 已入库" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className={btnSecondaryClassName}
          disabled={loading || page <= 1}
          onClick={() => void load(page - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          className={btnSecondaryClassName}
          disabled={loading || page >= totalPages}
          onClick={() => void load(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
