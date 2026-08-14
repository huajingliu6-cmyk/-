"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  CircleCheck,
  CircleDashed,
  CircleX,
  Download,
  Image as ImageIcon,
  Network,
  TriangleAlert,
  Type,
  Video,
} from "lucide-react";
import type {
  AiModelBinding,
  CapabilityRuleSummary,
  ModelConnectionPublic,
} from "@/auth/ai-admin/types";
import {
  connectionHost,
  loadAdminAiData,
  modalityLabel,
  type AdminAiData,
  type CapabilityBindingPublic,
  type ProfileConfigPublic,
} from "@/auth/ai-admin/admin-data";

type ResolvedRoute = {
  capability: CapabilityRuleSummary;
  capabilityBinding: CapabilityBindingPublic | null;
  slotId: string | null;
  slotBinding: AiModelBinding | null;
  connection: ModelConnectionPublic | null;
  profile: ProfileConfigPublic | null;
  routeType: "explicit" | "default" | "unbound" | "local" | "runtime-reuse";
  runnable: boolean;
  statusLabel: string;
  warning?: string;
};

const VIDEO_PRECHECK_ID = "video.reference-image.precheck";

function isArkCompatibleEndpoint(baseUrl: string | null | undefined): boolean {
  const value = (baseUrl ?? "").trim().toLowerCase();
  return (
    value.includes("ark.cn-beijing.volces.com") ||
    value.includes("/api/v3") ||
    value.includes("/contents/generations/tasks")
  );
}

function iconFor(modality: string) {
  if (modality === "image") return ImageIcon;
  if (modality === "video") return Video;
  if (modality === "audio") return AudioLines;
  return Type;
}

function isProfileRunnable(profile: ProfileConfigPublic | null): boolean {
  if (!profile || profile.enabled === false) return false;
  if (profile.provider === "mock") return true;
  if (profile.provider === "http") {
    return Boolean(profile.apiUrl.trim() && profile.hasApiKey);
  }
  if (profile.provider === "aliyun-wan27") return profile.hasApiKey;
  return false;
}

function isConnectionRunnable(connection: ModelConnectionPublic | null): boolean {
  if (!connection || !connection.enabled) return false;
  if (connection.providerMode === "mock") return true;
  if (connection.providerMode === "aliyun-wan27") {
    return connection.apiKeyConfigured;
  }
  return Boolean(connection.baseUrl?.trim() && connection.apiKeyConfigured);
}

function isPrecheckProfileRunnable(profile: ProfileConfigPublic | null): boolean {
  if (!profile || profile.enabled === false) return false;
  if (profile.provider !== "http") return false;
  return Boolean(
    profile.apiUrl.trim() &&
    profile.hasApiKey &&
    isArkCompatibleEndpoint(profile.apiUrl),
  );
}

function findCapabilityBinding(
  capability: CapabilityRuleSummary,
  bindings: CapabilityBindingPublic[],
): CapabilityBindingPublic | null {
  return bindings.find((item) => item.capabilityId === capability.capabilityId) ?? null;
}

function resolveRoutes(data: AdminAiData): ResolvedRoute[] {
  return data.rules.map((capability) => {
    const capabilityBinding = findCapabilityBinding(capability, data.capabilityBindings);

    if (capability.capabilityId === "script.split.generate") {
      return {
        capability,
        capabilityBinding,
        slotId: null,
        slotBinding: null,
        connection: null,
        profile: null,
        routeType: "local",
        runnable: true,
        statusLabel: "本地运行",
        warning: "当前产品界面使用本地分集，不调用外部模型",
      };
    }

    if (capability.capabilityId === VIDEO_PRECHECK_ID) {
      // This route intentionally does not resolve through the generic
      // capability -> slot -> modelConnection chain. The runtime first reads
      // the legacy video-ref-precheck profile, then falls back to legacy
      // video-shot, and only then asks the video capability resolver. Showing
      // an H2 connection selector here would imply a binding that may not be
      // consulted at all.
      const dedicated =
        data.profiles.find((item) => item.id === "video-ref-precheck") ?? null;
      const videoShot =
        data.profiles.find((item) => item.id === "video-shot") ?? null;
      const dedicatedReady = isPrecheckProfileRunnable(dedicated);
      const h2VideoBinding = findCapabilityBinding(
        data.rules.find((item) => item.capabilityId === "video.storyboard-shot.generate") ??
          capability,
        data.capabilityBindings,
      );
      const h2SlotId = h2VideoBinding
        ? h2VideoBinding.profileSlotId
        : "video-shot";
      const h2SlotBinding = h2SlotId
        ? data.slotBindings.find((item) => item.profileSlot === h2SlotId) ?? null
        : null;
      const h2Connection = h2SlotBinding?.modelConnectionId
        ? data.connections.find((item) => item.id === h2SlotBinding.modelConnectionId) ??
          null
        : null;
      const h2Profile = h2SlotId
        ? data.profiles.find((item) => item.id === h2SlotId) ?? null
        : null;
      const h2Ready = h2Connection
        ? isConnectionRunnable(h2Connection) &&
          isArkCompatibleEndpoint(h2Connection.baseUrl)
        : Boolean(
            h2Profile &&
              h2Profile.provider === "http" &&
              h2Profile.enabled !== false &&
              h2Profile.apiUrl.trim() &&
              h2Profile.hasApiKey &&
              isArkCompatibleEndpoint(h2Profile.apiUrl),
          );
      const legacyVideoShotReady =
        Boolean(
          videoShot &&
            videoShot.enabled !== false &&
            videoShot.provider === "http" &&
            videoShot.apiUrl.trim() &&
            videoShot.hasApiKey &&
            isArkCompatibleEndpoint(videoShot.apiUrl),
        );
      const profile = dedicatedReady
        ? dedicated
        : legacyVideoShotReady
          ? videoShot
          : h2Connection
            ? null
            : h2Profile;
      const connection = dedicatedReady || legacyVideoShotReady ? null : h2Connection;
      const runtimeReady = dedicatedReady || legacyVideoShotReady || Boolean(h2Ready);
      return {
        capability,
        capabilityBinding,
        slotId: profile?.id ?? h2SlotId,
        // Deliberately suppress the selector: changing this slot binding is
        // not guaranteed to change the first two runtime fallback branches.
        slotBinding: null,
        connection,
        profile,
        routeType: "runtime-reuse",
        runnable: capability.status === "active" && runtimeReady,
        statusLabel: dedicatedReady
          ? "专用预检"
          : legacyVideoShotReady
            ? "复用 video-shot"
            : h2Ready
              ? "跟随视频线路"
              : "需处理",
        warning:
          "预检运行时优先读取 video-ref-precheck，失败后复用 video-shot，最后才跟随视频能力线路；此处不直接切换连接",
      };
    }

    const slotId = capabilityBinding
      ? capabilityBinding.profileSlotId
      : capability.defaultProfileSlot;
    const slotBinding = slotId
      ? data.slotBindings.find((item) => item.profileSlot === slotId) ?? null
      : null;
    const explicitId = slotBinding?.modelConnectionId ?? null;
    const connection = explicitId
      ? data.connections.find((item) => item.id === explicitId) ?? null
      : null;
    const profile = slotId
      ? data.profiles.find((item) => item.id === slotId) ?? null
      : null;

    let routeType: ResolvedRoute["routeType"] = explicitId ? "explicit" : "default";
    if (!slotId || capability.status === "planned") routeType = "unbound";

    const enabled = capabilityBinding?.enabled ?? capability.status === "active";
    const runnable =
      capability.status === "active" &&
      enabled &&
      (explicitId ? isConnectionRunnable(connection) : isProfileRunnable(profile));

    let statusLabel = runnable ? "可运行" : "需要处理";
    if (capability.status === "planned") statusLabel = "尚未接线";
    else if (!enabled) statusLabel = "已停用";
    else if (explicitId && !connection) statusLabel = "连接缺失";
    else if (!slotId) statusLabel = "未配置";
    else if ((connection?.providerMode ?? profile?.provider) === "mock") statusLabel = "Mock";

    return {
      capability,
      capabilityBinding,
      slotId,
      slotBinding,
      connection,
      profile,
      routeType,
      runnable,
      statusLabel,
      warning: undefined,
    };
  });
}

function exportCsv(routes: ResolvedRoute[]) {
  const rows = [
    ["业务能力", "能力 ID", "模态", "槽位", "线路类型", "连接或配置", "模型", "状态"],
    ...routes.map((item) => [
      item.capability.label,
      item.capability.capabilityId,
      modalityLabel(item.capability.modality),
      item.slotId ?? "",
      item.routeType,
      item.connection?.displayName ?? item.profile?.label ?? "",
      item.connection?.modelId ?? item.profile?.model ?? "",
      item.statusLabel,
    ]),
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lumina-capability-routes-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CapabilityRoutingView() {
  const [data, setData] = useState<AdminAiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSlot, setSavingSlot] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loadAdminAiData());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载能力线路失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const routes = useMemo(() => (data ? resolveRoutes(data) : []), [data]);
  const runnableCount = routes.filter((item) => item.runnable).length;
  const issueCount = routes.filter(
    (item) => !item.runnable && item.capability.status === "active",
  ).length;
  const serviceCount = new Set(
    routes
      .filter((item) => item.runnable && item.routeType !== "local")
      .map((item) =>
        item.connection?.id ??
        (item.profile ? `profile:${item.profile.id}` : ""),
      )
      .filter(Boolean),
  ).size;

  const bind = async (route: ResolvedRoute, connectionId: string) => {
    if (!route.slotId) return;
    setSavingSlot(route.slotId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/ai-model-bindings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileSlot: route.slotId,
          modelConnectionId: connectionId || null,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "切换连接失败");
      setNotice(`已更新 ${route.slotId} 的连接线路`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "切换连接失败");
    } finally {
      setSavingSlot("");
    }
  };

  return (
    <section className="ai-admin-view" data-testid="admin-capability-routes">
      <div className="ai-admin-page-heading">
        <div><h1>能力线路</h1><p>直接显示业务功能最终调用的服务；槽位默认配置不会被误报为未绑定</p></div>
        <button type="button" className="ai-admin-button" disabled={!routes.length} onClick={() => exportCsv(routes)}><Download aria-hidden />导出线路表</button>
      </div>

      {error ? <div className="ai-admin-notice ai-admin-notice--error" role="alert">{error}</div> : null}
      {notice ? <div className="ai-admin-notice ai-admin-notice--success" role="status">{notice}</div> : null}

      <div className="ai-admin-route-summary">
        <div><CircleCheck aria-hidden /><span><strong>{runnableCount}</strong><small>可运行业务能力</small></span></div>
        <div className="is-warning"><TriangleAlert aria-hidden /><span><strong>{issueCount}</strong><small>需要处理</small></span></div>
        <div><Network aria-hidden /><span><strong>{serviceCount}</strong><small>正在使用的服务</small></span></div>
      </div>

      <div className="ai-admin-route-table" role="table" aria-label="业务能力实际调用线路">
        <div className="ai-admin-route-row ai-admin-route-row--head" role="row">
          <span>业务能力</span><span>实际线路</span><span>切换连接</span><span>状态</span>
        </div>
        {loading ? <p className="ai-admin-empty">加载线路中…</p> : null}
        {!loading && routes.length === 0 ? <p className="ai-admin-empty">暂无能力线路</p> : null}
        {routes.map((routeItem) => {
          const Icon = iconFor(routeItem.capability.modality);
          const selectableConnections = (data?.connections ?? []).filter(
            (connection) =>
              connection.modality === routeItem.capability.modality &&
              !connection.legacyVirtual,
          );
          const selectedId = routeItem.slotBinding?.modelConnectionId ?? "";
          const targetName = routeItem.connection?.displayName ?? routeItem.profile?.label ?? "未配置";
          const targetModel = routeItem.connection?.modelId ?? routeItem.profile?.model ?? "未填模型";
          const targetHost = routeItem.connection
            ? connectionHost(routeItem.connection.baseUrl)
            : connectionHost(routeItem.profile?.apiUrl ?? null);
          const StatusIcon = routeItem.runnable
            ? CircleCheck
            : routeItem.statusLabel === "Mock" || routeItem.routeType === "local"
              ? CircleDashed
              : routeItem.capability.status === "planned"
                ? CircleDashed
                : CircleX;
          return (
            <div className="ai-admin-route-row" role="row" key={routeItem.capability.capabilityId}>
              <div className="ai-admin-route-capability">
                <span className={`ai-admin-modality-icon is-${routeItem.capability.modality}`}><Icon aria-hidden /></span>
                <span><strong>{routeItem.capability.label}</strong><code>{routeItem.capability.capabilityId}</code>{routeItem.warning ? <small>{routeItem.warning}</small> : null}</span>
              </div>
              <div className="ai-admin-route-path">
                <span><small>{routeItem.routeType === "explicit" ? "独立连接" : routeItem.routeType === "local" ? "本地实现" : routeItem.routeType === "runtime-reuse" ? "运行时复用" : "槽位默认"}</small><strong>{routeItem.slotId ?? "无需模型槽位"}</strong></span>
                <ArrowRight aria-hidden />
                <span><small>{targetHost}</small><strong>{routeItem.routeType === "local" ? "本地分集算法" : `${targetName} · ${targetModel}`}</strong></span>
              </div>
              <select
                className="ai-admin-route-select"
                aria-label={`切换${routeItem.capability.label}连接`}
                value={selectedId}
                disabled={!routeItem.slotId || routeItem.routeType === "local" || (routeItem.routeType === "runtime-reuse" && routeItem.capability.capabilityId === VIDEO_PRECHECK_ID) || routeItem.capability.status === "planned" || savingSlot === routeItem.slotId}
                onChange={(event) => void bind(routeItem, event.target.value)}
              >
                <option value="">使用槽位默认配置</option>
                {selectableConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName}</option>)}
              </select>
              <span className={`ai-admin-route-health ${routeItem.runnable ? "is-success" : routeItem.statusLabel === "Mock" || routeItem.routeType === "local" ? "is-neutral" : "is-warning"}`}><StatusIcon aria-hidden />{routeItem.statusLabel}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
