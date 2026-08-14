"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Cable,
  CheckCircle2,
  ClipboardClock,
  CircleX,
  ListFilter,
  Route,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { AdminView } from "@/auth/ai-admin/AdminConsole";
import {
  loadAdminAiData,
  type AdminAiData,
} from "@/auth/ai-admin/admin-data";

type AdminOverviewProps = {
  onNavigate: (view: AdminView) => void;
};

type GenerationItem = { status: string; createdAt: string };
type ApprovalItem = { pendingCount: number; projectId: string; submittedAt: string };

type OverviewData = {
  ai: AdminAiData;
  generations: GenerationItem[];
  generationTotal: number;
  approvals: ApprovalItem[];
  approvalTotal: number;
};

function formatNow() {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function isProfileHealthy(data: AdminAiData, slotId: string | null) {
  if (!slotId) return false;
  const slot = data.slotBindings.find((item) => item.profileSlot === slotId);
  if (slot?.modelConnectionId) {
    const connection = data.connections.find((item) => item.id === slot.modelConnectionId);
    if (!connection || !connection.enabled) return false;
    if (connection.providerMode === "mock") return true;
    if (connection.providerMode === "aliyun-wan27") {
      return connection.apiKeyConfigured;
    }
    return Boolean(connection.baseUrl?.trim() && connection.apiKeyConfigured);
  }
  const profile = data.profiles.find((item) => item.id === slotId);
  if (!profile || profile.enabled === false) return false;
  if (profile.provider === "mock") return true;
  if (profile.provider === "http") return Boolean(profile.apiUrl.trim() && profile.hasApiKey);
  return profile.hasApiKey;
}

function isArkCompatibleEndpoint(baseUrl: string | null | undefined): boolean {
  const value = (baseUrl ?? "").trim().toLowerCase();
  return (
    value.includes("ark.cn-beijing.volces.com") ||
    value.includes("/api/v3") ||
    value.includes("/contents/generations/tasks")
  );
}

function isPrecheckProfileHealthy(profile: AdminAiData["profiles"][number] | null) {
  return Boolean(
    profile &&
      profile.enabled !== false &&
      profile.provider === "http" &&
      profile.apiUrl.trim() &&
      profile.hasApiKey &&
      isArkCompatibleEndpoint(profile.apiUrl),
  );
}

function isPrecheckHealthy(data: AdminAiData): boolean {
  if (isPrecheckProfileHealthy(data.profiles.find((item) => item.id === "video-ref-precheck") ?? null)) {
    return true;
  }
  // The runtime reads the legacy video-shot profile before consulting the
  // capability resolver, even when video-shot has an explicit H2 binding.
  if (isPrecheckProfileHealthy(data.profiles.find((item) => item.id === "video-shot") ?? null)) {
    return true;
  }

  const videoBinding = bindingFor(data, "video.storyboard-shot.generate");
  const slotId = videoBinding ? videoBinding.profileSlotId : "video-shot";
  if (!slotId) return false;
  const slotBinding = data.slotBindings.find((item) => item.profileSlot === slotId);
  if (slotBinding?.modelConnectionId) {
    const connection = data.connections.find((item) => item.id === slotBinding.modelConnectionId);
    return Boolean(
      connection &&
        connection.enabled &&
        connection.providerMode === "http" &&
        connection.apiKeyConfigured &&
        isArkCompatibleEndpoint(connection.baseUrl),
    );
  }
  return isPrecheckProfileHealthy(data.profiles.find((item) => item.id === slotId) ?? null);
}

function bindingFor(
  data: AdminAiData,
  capabilityId: string,
): AdminAiData["capabilityBindings"][number] | null {
  return (
    data.capabilityBindings.find((item) => item.capabilityId === capabilityId) ??
    null
  );
}

/**
 * Return the route that is actually used by the product surface. Some
 * registry entries are compatibility aliases (asset prompt) or are local
 * implementations (script split), so their own default slot is not the
 * runtime slot shown to an administrator.
 */
function effectiveSlotFor(
  data: AdminAiData,
  capabilityId: string,
  defaultSlot: string | null,
): { slotId: string | null; bindingEnabled: boolean; local: boolean } {
  if (capabilityId === "script.split.generate") {
    return { slotId: null, bindingEnabled: true, local: true };
  }
  if (capabilityId === "asset.design-prompt.generate") {
    const sourceBinding = bindingFor(data, "asset.episode-design.generate");
    return {
      slotId: "episode-asset-design-text",
      bindingEnabled: sourceBinding?.enabled ?? true,
      local: false,
    };
  }
  if (capabilityId === "video.reference-image.precheck") {
    const dedicated = data.profiles.find((item) => item.id === "video-ref-precheck");
    const dedicatedReady = isPrecheckProfileHealthy(dedicated ?? null);
    if (dedicatedReady) {
      // The precheck resolver reads this legacy profile directly; its H2 slot
      // binding is intentionally not consulted by the runtime.
      return { slotId: "video-ref-precheck", bindingEnabled: true, local: false };
    }
    const legacyVideoShot = data.profiles.find((item) => item.id === "video-shot");
    if (isPrecheckProfileHealthy(legacyVideoShot ?? null)) {
      return { slotId: "video-shot", bindingEnabled: true, local: false };
    }
    const videoBinding = bindingFor(data, "video.storyboard-shot.generate");
    return {
      slotId: videoBinding ? videoBinding.profileSlotId : "video-shot",
      bindingEnabled: videoBinding?.enabled ?? true,
      local: false,
    };
  }
  const binding = bindingFor(data, capabilityId);
  return {
    // A persisted null is an explicit unbind. Only a missing binding may use
    // the registry default.
    slotId: binding ? binding.profileSlotId : defaultSlot,
    bindingEnabled: binding?.enabled ?? true,
    local: false,
  };
}

async function loadOverview(): Promise<OverviewData> {
  const [ai, generationsRes, approvalsRes] = await Promise.all([
    loadAdminAiData(),
    fetch("/api/admin/text-generations?page=1&pageSize=100", { cache: "no-store" }),
    fetch("/api/admin/asset-approvals?page=1&pageSize=100&status=pending", { cache: "no-store" }),
  ]);
  const generationsPayload = (await generationsRes.json()) as {
    items?: GenerationItem[];
    total?: number;
    error?: string;
  };
  const approvalsPayload = (await approvalsRes.json()) as {
    items?: ApprovalItem[];
    total?: number;
    error?: string;
  };
  if (!generationsRes.ok) throw new Error(generationsPayload.error ?? "加载生成任务失败");
  if (!approvalsRes.ok) throw new Error(approvalsPayload.error ?? "加载审批数据失败");
  return {
    ai,
    generations: generationsPayload.items ?? [],
    generationTotal: generationsPayload.total ?? 0,
    approvals: approvalsPayload.items ?? [],
    approvalTotal: approvalsPayload.total ?? 0,
  };
}

export function AdminOverview({ onNavigate }: AdminOverviewProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loadOverview());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载运行概览失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const stats = useMemo(() => {
    if (!data) {
      return {
        enabledConnections: 0,
        testedConnections: 0,
        activeCapabilities: 0,
        healthyCapabilities: 0,
        todayTotal: 0,
        completed: 0,
        failed: 0,
        running: 0,
        pendingAssets: 0,
        pendingProjects: 0,
      };
    }
    const activeRules = data.ai.rules.filter((item) => item.status === "active");
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const todayItems = data.generations.filter((item) => item.createdAt.slice(0, 10) === todayKey);
    return {
      enabledConnections: data.ai.connections.filter((item) => item.enabled).length,
      testedConnections: data.ai.connections.filter((item) => item.lastTestStatus === "success").length,
      activeCapabilities: activeRules.length,
      healthyCapabilities: activeRules.filter((item) => {
        if (item.capabilityId === "video.reference-image.precheck") {
          return isPrecheckHealthy(data.ai);
        }
        const route = effectiveSlotFor(data.ai, item.capabilityId, item.defaultProfileSlot);
        return route.local || (route.bindingEnabled && isProfileHealthy(data.ai, route.slotId));
      }).length,
      todayTotal: todayItems.length,
      completed: todayItems.filter((item) => item.status === "completed").length,
      failed: todayItems.filter((item) => item.status === "failed").length,
      running: todayItems.filter((item) => item.status === "running" || item.status === "queued").length,
      pendingAssets: data.approvals.reduce((sum, item) => sum + item.pendingCount, 0),
      pendingProjects: new Set(data.approvals.map((item) => item.projectId)).size,
    };
  }, [data]);

  const successRate = stats.todayTotal
    ? Math.round((stats.completed / stats.todayTotal) * 1000) / 10
    : 0;
  const healthPercent = stats.activeCapabilities
    ? (stats.healthyCapabilities / stats.activeCapabilities) * 100
    : 0;
  const issues: Array<{ title: string; detail: string; view: AdminView; danger?: boolean }> = [];
  if (stats.healthyCapabilities < stats.activeCapabilities) {
    issues.push({
      title: `${stats.activeCapabilities - stats.healthyCapabilities} 项业务能力需要检查线路`,
      detail: "可能存在连接停用、地址缺失或凭据未配置",
      view: "routes",
      danger: true,
    });
  }
  const untested = data?.ai.connections.filter((item) => item.enabled && item.lastTestStatus === "untested").length ?? 0;
  if (untested) {
    issues.push({
      title: `${untested} 条启用连接尚未执行测试`,
      detail: "不会阻断调用，但暂时无法确认外部服务状态",
      view: "connections",
    });
  }
  if (stats.failed) {
    issues.push({
      title: `今日有 ${stats.failed} 个生成任务失败`,
      detail: "可在生成记录中查看 Provider 或配置错误详情",
      view: "generations",
    });
  }

  return (
    <section className="ai-admin-view" data-testid="admin-overview">
      <div className="ai-admin-page-heading">
        <div><h1>运行概览</h1><p>{formatNow()} · 数据来自现有模型配置、生成记录和素材审批</p></div>
        <button type="button" className="ai-admin-button" onClick={() => onNavigate("generations")}><ListFilter aria-hidden />查看异常任务</button>
      </div>
      {error ? <div className="ai-admin-notice ai-admin-notice--error" role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></div> : null}

      <div className="ai-admin-metrics" aria-busy={loading}>
        <article><div><span>API 连接</span><Cable aria-hidden /></div><p><strong>{data?.ai.connections.length ?? "—"}</strong><small>{stats.enabledConnections} 条启用</small></p><footer><i />{stats.testedConnections} 条已通过测试</footer></article>
        <article><div><span>可运行业务能力</span><Route aria-hidden /></div><p><strong>{stats.healthyCapabilities}</strong><small>/ {stats.activeCapabilities}</small></p><footer className={stats.healthyCapabilities === stats.activeCapabilities ? "" : "is-warning"}><i />{stats.activeCapabilities - stats.healthyCapabilities} 项需要处理</footer></article>
        <article><div><span>今日生成任务</span><Sparkles aria-hidden /></div><p><strong>{stats.todayTotal}</strong><small>共 {data?.generationTotal ?? 0} 条记录</small></p><footer><i />成功率 {successRate}%</footer></article>
        <article><div><span>待审批素材</span><ClipboardClock aria-hidden /></div><p><strong>{stats.pendingAssets}</strong><small>{stats.pendingProjects} 个项目</small></p><footer className={stats.pendingAssets ? "is-warning" : ""}><i />{data?.approvalTotal ?? 0} 条待处理提交</footer></article>
      </div>

      <div className="ai-admin-overview-grid">
        <section className="ai-admin-panel ai-admin-trend-panel">
          <header><div><h2>服务健康度</h2><p>启用业务能力的实际线路覆盖</p></div></header>
          <svg viewBox="0 0 640 220" role="img" aria-labelledby="admin-health-title admin-health-desc">
            <title id="admin-health-title">业务能力线路健康度</title>
            <desc id="admin-health-desc">显示当前可运行与需要处理的业务能力比例。</desc>
            <g className="ai-admin-chart-grid"><path d="M48 32H608M48 82H608M48 132H608M48 182H608" /></g>
            <g className="ai-admin-chart-axis"><text x="12" y="36">100%</text><text x="18" y="86">75%</text><text x="18" y="136">50%</text><text x="18" y="186">25%</text></g>
            <path className="ai-admin-chart-area" d={`M52 182 L52 ${182 - healthPercent * 1.5} L604 ${182 - healthPercent * 1.5} L604 182 Z`} />
            <path className="ai-admin-chart-line" d={`M52 ${182 - healthPercent * 1.5} L604 ${182 - healthPercent * 1.5}`} />
            <circle className="ai-admin-chart-point" cx="604" cy={182 - healthPercent * 1.5} r="5" />
            <text className="ai-admin-chart-value" x="548" y={Math.max(25, 172 - healthPercent * 1.5)}>{Math.round(healthPercent)}%</text>
          </svg>
        </section>

        <section className="ai-admin-panel ai-admin-status-panel">
          <header><div><h2>今日任务状态</h2><p>{stats.todayTotal} 个生成任务</p></div></header>
          <div className="ai-admin-donut-wrap">
            <div className="ai-admin-donut" style={{ "--success-angle": `${successRate * 3.6}deg` } as CSSProperties}><span><strong>{successRate}%</strong><small>任务成功率</small></span></div>
            <div className="ai-admin-donut-legend"><span><i className="is-success" />成功 {stats.completed}</span><span><i className="is-running" />排队/运行 {stats.running}</span><span><i className="is-failed" />失败 {stats.failed}</span></div>
          </div>
        </section>
      </div>

      <section className="ai-admin-panel ai-admin-issues">
        <header><div><h2>需要处理</h2><p>只展示会影响业务调用或排障判断的问题</p></div></header>
        {issues.length === 0 ? <div className="ai-admin-all-good"><CheckCircle2 aria-hidden />当前没有需要处理的配置问题</div> : null}
        {issues.map((issue) => (
          <div className={issue.danger ? "is-danger" : ""} key={issue.title}>
            {issue.danger ? <CircleX aria-hidden /> : <TriangleAlert aria-hidden />}
            <span><strong>{issue.title}</strong><small>{issue.detail}</small></span>
            <button type="button" onClick={() => onNavigate(issue.view)}>去处理</button>
          </div>
        ))}
      </section>
    </section>
  );
}
