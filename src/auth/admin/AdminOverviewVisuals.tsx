"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  Cpu,
  FileCheck2,
  RefreshCw,
  ServerCog,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  CapabilityDiag,
  ModelConnectionPublic,
} from "@/auth/ai-admin/types";
import "./admin.css";

type GenerationItem = {
  generationId: string;
  status: string;
  outputKind: string;
  createdAt: string;
  updatedAt: string;
};

type OverviewState = {
  connections: ModelConnectionPublic[];
  capabilities: CapabilityDiag[];
  generations: GenerationItem[];
  generationTotal: number;
  pendingApprovalTotal: number;
};

type ActivityPoint = {
  key: string;
  label: string;
  count: number;
};

type Tone = "positive" | "warning" | "negative" | "neutral";

type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  tone: Tone;
  icon: LucideIcon;
  href?: string;
};

const EMPTY_STATE: OverviewState = {
  connections: [],
  capabilities: [],
  generations: [],
  generationTotal: 0,
  pendingApprovalTotal: 0,
};

const STATUS_META: Array<{
  id: string;
  label: string;
  color: string;
}> = [
  { id: "completed", label: "成功", color: "#34d399" },
  { id: "running", label: "运行中", color: "#38bdf8" },
  { id: "queued", label: "排队", color: "#fbbf24" },
  { id: "failed", label: "失败", color: "#fb7185" },
  { id: "cancelled", label: "取消", color: "#71717a" },
];

const MODALITY_META = [
  { id: "text", label: "文本", color: "#a78bfa" },
  { id: "image", label: "图像", color: "#22d3ee" },
  { id: "audio", label: "音频", color: "#fbbf24" },
  { id: "video", label: "视频", color: "#fb7185" },
] as const;

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || `请求失败（${response.status}）`);
  }
  return payload;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildActivitySeries(
  generations: GenerationItem[],
  anchorIso: string,
): ActivityPoint[] {
  const anchor = new Date(anchorIso);
  anchor.setHours(12, 0, 0, 0);
  const counts = new Map<string, number>();

  for (const generation of generations) {
    const date = new Date(generation.createdAt || generation.updatedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = localDateKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() - (13 - index));
    const key = localDateKey(date);
    return {
      key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      count: counts.get(key) ?? 0,
    };
  });
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: Tone;
}) {
  return (
    <article className={`admin-ov-metric is-${tone}`}>
      <span className="admin-ov-metric__icon" aria-hidden>
        <Icon />
      </span>
      <div className="admin-ov-metric__copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function ActivityChart({ points }: { points: ActivityPoint[] }) {
  const width = 640;
  const height = 194;
  const left = 38;
  const right = 622;
  const top = 18;
  const bottom = 150;
  const peak = Math.max(1, ...points.map((point) => point.count));
  const xStep = (right - left) / Math.max(1, points.length - 1);
  const y = (count: number) => bottom - (count / peak) * (bottom - top);
  const chartPoints = points.map((point, index) => ({
    ...point,
    x: left + index * xStep,
    y: y(point.count),
  }));
  const polyline = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${left},${bottom} ${polyline} ${right},${bottom}`;

  return (
    <div className="admin-ov-chart-scroll">
      <svg
        className="admin-ov-activity-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="最近十四天生成任务趋势"
      >
        {[0, 1, 2, 3].map((step) => {
          const ratio = step / 3;
          const gridY = bottom - ratio * (bottom - top);
          return (
            <g key={step}>
              <line
                x1={left}
                x2={right}
                y1={gridY}
                y2={gridY}
                className="admin-ov-chart-grid"
              />
              <text x={left - 9} y={gridY + 4} className="admin-ov-chart-axis" textAnchor="end">
                {Math.round(peak * ratio)}
              </text>
            </g>
          );
        })}
        {points.length > 0 ? (
          <>
            <polygon points={area} className="admin-ov-chart-area" />
            <polyline points={polyline} className="admin-ov-chart-line" />
            {chartPoints.map((point, index) => (
              <g key={point.key}>
                <circle cx={point.x} cy={point.y} r="3.5" className="admin-ov-chart-point">
                  <title>{`${point.label}：${point.count} 个任务`}</title>
                </circle>
                {(index % 2 === 0 || index === chartPoints.length - 1) && (
                  <text
                    x={point.x}
                    y={bottom + 24}
                    className="admin-ov-chart-axis"
                    textAnchor="middle"
                  >
                    {point.label}
                  </text>
                )}
              </g>
            ))}
          </>
        ) : null}
      </svg>
    </div>
  );
}

function StatusRing({ generations }: { generations: GenerationItem[] }) {
  const counts = STATUS_META.map((status) => ({
    ...status,
    count: generations.filter((item) => item.status === status.id).length,
  }));
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  const completed = counts.find((item) => item.id === "completed")?.count ?? 0;
  const settled = counts
    .filter((item) => ["completed", "failed", "cancelled"].includes(item.id))
    .reduce((sum, item) => sum + item.count, 0);
  const successRate = settled > 0 ? Math.round((completed / settled) * 100) : 0;
  let offset = 0;

  return (
    <div className="admin-ov-status-layout">
      <div className="admin-ov-status-ring">
        <svg viewBox="0 0 160 160" role="img" aria-label={`最近任务成功率 ${successRate}%`}>
          <circle cx="80" cy="80" r="54" className="admin-ov-ring-track" />
          {counts.map((item) => {
            if (total === 0 || item.count === 0) return null;
            const percentage = (item.count / total) * 100;
            const segmentOffset = offset;
            offset += percentage;
            return (
              <circle
                key={item.id}
                cx="80"
                cy="80"
                r="54"
                pathLength="100"
                className="admin-ov-ring-segment"
                style={{
                  stroke: item.color,
                  strokeDasharray: `${Math.max(0, percentage - 0.8)} ${100 - Math.max(0, percentage - 0.8)}`,
                  strokeDashoffset: -segmentOffset,
                }}
              >
                <title>{`${item.label}：${item.count}`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="admin-ov-status-ring__value">
          <strong>{total > 0 ? `${successRate}%` : "--"}</strong>
          <span>完成成功率</span>
        </div>
      </div>
      <ul className="admin-ov-status-legend" aria-label="生成任务状态明细">
        {counts.map((item) => (
          <li key={item.id}>
            <span className="admin-ov-legend-dot" style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
            <strong>{item.count}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CapabilityCoverage({ capabilities }: { capabilities: CapabilityDiag[] }) {
  const active = capabilities.filter((capability) => capability.status === "active");
  const groups = MODALITY_META.map((modality) => {
    const list = active.filter((capability) => capability.modality === modality.id);
    return {
      ...modality,
      total: list.length,
      runnable: list.filter((capability) => capability.runnable).length,
    };
  });

  return (
    <div className="admin-ov-coverage" aria-label="按类型统计的 AI 能力可运行情况">
      {groups.map((group) => {
        const percentage = group.total > 0 ? (group.runnable / group.total) * 100 : 0;
        return (
          <div className="admin-ov-coverage__row" key={group.id}>
            <div className="admin-ov-coverage__label">
              <span>{group.label}</span>
              <strong>{group.runnable}/{group.total}</strong>
            </div>
            <div className="admin-ov-coverage__track" aria-hidden>
              <span style={{ width: `${percentage}%`, backgroundColor: group.color }} />
            </div>
            <small>{group.total === 0 ? "暂无能力" : `${Math.round(percentage)}% 可运行`}</small>
          </div>
        );
      })}
    </div>
  );
}

function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="admin-ov-all-clear">
        <CheckCircle2 aria-hidden />
        <div>
          <strong>当前没有阻塞项</strong>
          <span>已启用连接与上线能力均处于可运行状态。</span>
        </div>
      </div>
    );
  }

  return (
    <ul className="admin-ov-attention-list">
      {items.slice(0, 6).map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.id} className={`is-${item.tone}`}>
            {item.href ? (
              <Link href={item.href} className="admin-ov-attention-list__link">
                <span className="admin-ov-attention-list__icon" aria-hidden>
                  <Icon />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
              </Link>
            ) : (
              <>
                <span className="admin-ov-attention-list__icon" aria-hidden>
                  <Icon />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AdminOverviewVisuals() {
  const [data, setData] = useState<OverviewState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState(() => new Date().toISOString());

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");

    const results = await Promise.allSettled([
      readJson<{ connections?: ModelConnectionPublic[] }>(
        "/api/admin/model-connections",
        signal,
      ),
      readJson<{ capabilities?: CapabilityDiag[] }>(
        "/api/admin/api-configs",
        signal,
      ),
      readJson<{
        items?: GenerationItem[];
        total?: number;
      }>("/api/admin/text-generations?page=1&pageSize=50", signal),
      readJson<{ total?: number }>(
        "/api/admin/asset-approvals?page=1&pageSize=1&status=pending",
        signal,
      ),
    ]);

    if (signal?.aborted) return;

    const [connectionsResult, capabilitiesResult, generationsResult, approvalsResult] = results;
    setData((current) => ({
      connections:
        connectionsResult.status === "fulfilled"
          ? connectionsResult.value.connections ?? []
          : current.connections,
      capabilities:
        capabilitiesResult.status === "fulfilled"
          ? capabilitiesResult.value.capabilities ?? []
          : current.capabilities,
      generations:
        generationsResult.status === "fulfilled"
          ? generationsResult.value.items ?? []
          : current.generations,
      generationTotal:
        generationsResult.status === "fulfilled"
          ? generationsResult.value.total ?? 0
          : current.generationTotal,
      pendingApprovalTotal:
        approvalsResult.status === "fulfilled"
          ? approvalsResult.value.total ?? 0
          : current.pendingApprovalTotal,
    }));

    const failureCount = results.filter((result) => result.status === "rejected").length;
    if (failureCount === results.length) {
      setError("概览数据加载失败，请检查管理员权限或服务状态后重试。");
    } else if (failureCount > 0) {
      setError(`有 ${failureCount} 项概览数据暂时不可用，其余数据已更新。`);
    }

    const now = new Date().toISOString();
    if (failureCount < results.length) {
      setLastUpdated(now);
      setAnchorDate(now);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview]);

  const enabledConnections = data.connections.filter((connection) => connection.enabled);
  const healthyConnections = enabledConnections.filter(
    (connection) => connection.lastTestStatus === "success",
  );
  const activeCapabilities = data.capabilities.filter(
    (capability) => capability.status === "active",
  );
  const runnableCapabilities = activeCapabilities.filter(
    (capability) => capability.runnable,
  );
  const activitySeries = useMemo(
    () => buildActivitySeries(data.generations, anchorDate),
    [anchorDate, data.generations],
  );

  const settledGenerations = data.generations.filter((generation) =>
    ["completed", "failed", "cancelled"].includes(generation.status),
  );
  const completedGenerations = settledGenerations.filter(
    (generation) => generation.status === "completed",
  );
  const recentSuccessRate =
    settledGenerations.length > 0
      ? Math.round((completedGenerations.length / settledGenerations.length) * 100)
      : 0;

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    for (const connection of enabledConnections.filter(
      (candidate) => candidate.lastTestStatus === "failed",
    )) {
      items.push({
        id: `connection-failed-${connection.id}`,
        title: `${connection.displayName} 测试失败`,
        detail: connection.lastTestMessage || "请检查地址、模型 ID 与凭证。",
        tone: "negative",
        icon: XCircle,
        href: connection.id.startsWith("legacy-slot-")
          ? `/app/admin/apis#${connection.id.slice("legacy-slot-".length)}`
          : "/app/admin/apis",
      });
    }
    for (const capability of activeCapabilities.filter(
      (candidate) => !candidate.runnable,
    )) {
      items.push({
        id: `capability-${capability.capabilityId}`,
        title: `${capability.label} 暂不可运行`,
        detail: capability.health || "请补齐模型连接与功能绑定。",
        tone: "warning",
        icon: ShieldAlert,
        href: capability.profileSlotId
          ? `/app/admin/apis#${capability.profileSlotId}`
          : "/app/admin/apis",
      });
    }
    const untestedCount = enabledConnections.filter(
      (connection) => connection.lastTestStatus === "untested",
    ).length;
    if (untestedCount > 0) {
      items.push({
        id: "untested-connections",
        title: `${untestedCount} 条连接尚未验证`,
        detail: "保存连接后执行一次连通性测试，避免在业务调用时才暴露配置错误。",
        tone: "neutral",
        icon: CircleDot,
        href: "/app/admin/apis",
      });
    }
    if (data.pendingApprovalTotal > 0) {
      items.push({
        id: "pending-approvals",
        title: `${data.pendingApprovalTotal} 项素材审批待处理`,
        detail: "审批队列中仍有待确认的资产提交。",
        tone: "warning",
        icon: Clock3,
        href: "/app/admin/approvals",
      });
    }
    return items;
  }, [activeCapabilities, data.pendingApprovalTotal, enabledConnections]);

  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "尚未同步";

  return (
    <section className="admin-ov" aria-labelledby="admin-overview-title" aria-busy={loading} data-testid="admin-overview">
      <header className="admin-ov-header">
        <div>
          <span className="admin-ov-eyebrow">SYSTEM OVERVIEW</span>
          <h2 id="admin-overview-title">运行概览</h2>
          <p>从连接、能力、任务与审批四个层面检查系统当前状态。</p>
        </div>
        <div className="admin-ov-header__actions">
          <span className="admin-ov-updated">更新于 {lastUpdatedLabel}</span>
          <button
            type="button"
            className="admin-ov-refresh"
            title="刷新概览"
            disabled={loading}
            onClick={() => void loadOverview()}
          >
            <RefreshCw className={loading ? "is-spinning" : ""} aria-hidden />
            <span>{loading ? "同步中" : "刷新"}</span>
          </button>
        </div>
      </header>

      {error ? (
        <div className="admin-ov-notice" role="status">
          <AlertTriangle aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="admin-ov-metrics">
        <MetricCard
          icon={ServerCog}
          label="模型连接"
          value={loading && !lastUpdated ? "--" : `${enabledConnections.length}/${data.connections.length}`}
          detail={`${healthyConnections.length} 条已测试通过`}
          tone={
            enabledConnections.length > 0 && healthyConnections.length === enabledConnections.length
              ? "positive"
              : "warning"
          }
        />
        <MetricCard
          icon={Cpu}
          label="上线能力"
          value={loading && !lastUpdated ? "--" : `${runnableCapabilities.length}/${activeCapabilities.length}`}
          detail="可直接响应业务调用"
          tone={
            activeCapabilities.length > 0 && runnableCapabilities.length === activeCapabilities.length
              ? "positive"
              : "warning"
          }
        />
        <MetricCard
          icon={Sparkles}
          label="累计生成任务"
          value={loading && !lastUpdated ? "--" : compactNumber(data.generationTotal)}
          detail={`最近记录成功率 ${settledGenerations.length ? `${recentSuccessRate}%` : "--"}`}
          tone={recentSuccessRate >= 90 ? "positive" : recentSuccessRate > 0 ? "neutral" : "warning"}
        />
        <MetricCard
          icon={FileCheck2}
          label="待审批素材"
          value={loading && !lastUpdated ? "--" : compactNumber(data.pendingApprovalTotal)}
          detail={data.pendingApprovalTotal > 0 ? "需要管理员处理" : "审批队列已清空"}
          tone={data.pendingApprovalTotal > 0 ? "warning" : "positive"}
        />
      </div>

      <div className="admin-ov-primary-grid">
        <section className="admin-ov-panel admin-ov-panel--activity">
          <div className="admin-ov-panel__head">
            <div>
              <span className="admin-ov-panel__icon" aria-hidden><Activity /></span>
              <div>
                <h3>生成任务趋势</h3>
                <p>最近 14 天，基于最新 50 条任务记录</p>
              </div>
            </div>
            <strong>{activitySeries.reduce((sum, point) => sum + point.count, 0)}</strong>
          </div>
          <ActivityChart points={activitySeries} />
        </section>

        <section className="admin-ov-panel">
          <div className="admin-ov-panel__head">
            <div>
              <span className="admin-ov-panel__icon is-cyan" aria-hidden><CheckCircle2 /></span>
              <div>
                <h3>任务状态</h3>
                <p>最近 {data.generations.length} 条生成记录</p>
              </div>
            </div>
          </div>
          <StatusRing generations={data.generations} />
        </section>
      </div>

      <div className="admin-ov-secondary-grid">
        <section className="admin-ov-panel">
          <div className="admin-ov-panel__head">
            <div>
              <span className="admin-ov-panel__icon is-amber" aria-hidden><Cpu /></span>
              <div>
                <h3>能力覆盖</h3>
                <p>按模型类型查看上线功能可用率</p>
              </div>
            </div>
          </div>
          <CapabilityCoverage capabilities={data.capabilities} />
        </section>

        <section className="admin-ov-panel">
          <div className="admin-ov-panel__head">
            <div>
              <span className="admin-ov-panel__icon is-rose" aria-hidden><ShieldAlert /></span>
              <div>
                <h3>需要处理</h3>
                <p>按运行影响聚合配置与审批问题</p>
              </div>
            </div>
            {attentionItems.length > 0 ? <strong>{attentionItems.length}</strong> : null}
          </div>
          <AttentionList items={attentionItems} />
        </section>
      </div>
    </section>
  );
}
