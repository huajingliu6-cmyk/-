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

type HistoryItem = {
  generationId: string;
  projectId: string;
  projectName: string;
  userId: string;
  username: string;
  displayName: string;
  outputKind: string;
  modelKey: string;
  displayModelName: string;
  providerModelId: string;
  status: string;
  brief: string;
  content: string;
  actualChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
  chargedPoints: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListResponse = {
  items: HistoryItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  error?: string;
};

const OUTPUT_KIND_LABELS: Record<string, string> = {
  story: "小故事",
  script: "剧本",
  script_outline: "剧本大纲",
  script_episodes: "剧集正文",
  script_split: "智能分集",
  episode_asset_design: "单集资产设计",
  asset_design_prompt: "素材提示词",
  storyboard_prompt: "分镜提示词",
};

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

function formatTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function TextGenerationsHistoryTab({ active }: Props) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [outputKind, setOutputKind] = useState("");
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
        if (outputKind) params.set("outputKind", outputKind);
        if (status) params.set("status", status);
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/admin/text-generations?${params}`);
        const data = await readJson<ListResponse>(res);
        if (!res.ok) throw new Error(data.error ?? "加载生成历史失败");
        setItems(data.items ?? []);
        setPage(data.page ?? nextPage);
        setTotalPages(data.totalPages ?? 1);
        setTotal(data.total ?? 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载生成历史失败");
      } finally {
        setLoading(false);
      }
    },
    [outputKind, page, q, status],
  );

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      // Yield so setState inside load is not synchronous with the effect body.
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
    <div className="space-y-3" data-testid="admin-text-generations-history">
      <SectionTitle>文本生成历史</SectionTitle>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        查看用户每次调用文本模型的输出记录（用户名、时间、模型、完整正文）。
      </p>

      <InlineNotices error={error} onDismissError={() => setError("")} />

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
        <label className="min-w-[7rem] flex-1 text-[11px] text-zinc-400">
          输出类型
          <select
            className={inputClassName}
            value={outputKind}
            onChange={(e) => setOutputKind(e.target.value)}
          >
            <option value="">全部</option>
            {Object.entries(OUTPUT_KIND_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
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
          搜索正文/用户材料
          <input
            className={inputClassName}
            value={q}
            placeholder="关键词"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(1);
            }}
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

      <div className="text-[11px] text-zinc-500">
        共 {total} 条 · 第 {page}/{totalPages} 页
      </div>

      <div className="space-y-2">
        {items.length === 0 && !loading ? (
          <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-xs text-zinc-500">
            暂无生成记录
          </div>
        ) : null}
        {items.map((item) => {
          const open = expandedId === item.generationId;
          return (
            <article
              key={item.generationId}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50"
              data-testid={`admin-tg-${item.generationId}`}
            >
              <button
                type="button"
                className="flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-zinc-900"
                onClick={() =>
                  setExpandedId((prev) =>
                    prev === item.generationId ? null : item.generationId,
                  )
                }
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-200">
                  <span className="font-semibold">{item.username}</span>
                  {item.displayName && item.displayName !== item.username ? (
                    <span className="text-zinc-500">({item.displayName})</span>
                  ) : null}
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-400">{formatTime(item.createdAt)}</span>
                  <span className="text-zinc-600">·</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-violet-200">
                    {OUTPUT_KIND_LABELS[item.outputKind] ?? item.outputKind}
                  </span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                    {STATUS_LABELS[item.status] ?? item.status}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500">
                  {item.displayModelName || item.providerModelId || item.modelKey}
                  {" · "}
                  {item.projectName}
                  {item.actualChars ? ` · ${item.actualChars} 字` : ""}
                </div>
                {!open && item.content ? (
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-zinc-400">
                    {item.content}
                  </p>
                ) : null}
                {!open && !item.content && item.errorMessage ? (
                  <p className="text-[11px] text-rose-300">{item.errorMessage}</p>
                ) : null}
              </button>
              {open ? (
                <div className="space-y-2 border-t border-zinc-800 px-3 py-3">
                  <div className="text-[10px] text-zinc-500">
                    ID {item.generationId}
                    {item.chargedPoints
                      ? ` · 扣费 ${item.chargedPoints} 积分`
                      : ""}
                    {item.inputTokens != null
                      ? ` · in ${item.inputTokens}`
                      : ""}
                    {item.outputTokens != null
                      ? ` · out ${item.outputTokens}`
                      : ""}
                  </div>
                  {item.errorMessage ? (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 px-2.5 py-2 text-[11px] text-rose-200">
                      {item.errorMessage}
                    </div>
                  ) : null}
                  <div>
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      输出内容
                    </div>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-black/30 p-2.5 text-[11px] leading-relaxed text-zinc-200">
                      {item.content.trim() || "（无正文）"}
                    </pre>
                  </div>
                  {item.brief.trim() ? (
                    <details className="text-[11px] text-zinc-400">
                      <summary className="cursor-pointer select-none text-zinc-500">
                        查看输入材料
                      </summary>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-black/20 p-2.5 text-[11px] leading-relaxed">
                        {item.brief}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
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
