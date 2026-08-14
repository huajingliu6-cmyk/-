"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Bell,
  Cable,
  CheckCircle2,
  ClipboardCheck,
  FileCog,
  Gauge,
  History,
  LockKeyhole,
  RefreshCw,
  Route,
  ShieldCheck,
} from "lucide-react";
import { AssetApprovalsHistoryTab } from "@/auth/ai-admin/AssetApprovalsHistoryTab";
import { CapabilityRulesTab } from "@/auth/ai-admin/CapabilityRulesTab";
import { TextGenerationsHistoryTab } from "@/auth/ai-admin/TextGenerationsHistoryTab";
import { AdminOverview } from "@/auth/ai-admin/AdminOverview";
import { CapabilityRoutingView } from "@/auth/ai-admin/CapabilityRoutingView";
import { ModelConnectionsView } from "@/auth/ai-admin/ModelConnectionsView";
import type { AuthUser } from "@/auth/types";
import "@/auth/ai-admin/admin-console.css";

export type AdminView =
  | "overview"
  | "connections"
  | "routes"
  | "rules"
  | "generations"
  | "approvals";

type AdminConsoleProps = {
  initialView?: AdminView;
  user: AuthUser;
};

const VIEW_META: Record<AdminView, { title: string; subtitle: string }> = {
  overview: { title: "运行概览", subtitle: "服务、业务能力与任务健康度" },
  connections: { title: "API 连接", subtitle: "统一管理模型服务的接入配置" },
  routes: { title: "能力线路", subtitle: "查看业务功能最终调用的模型服务" },
  rules: { title: "任务规则", subtitle: "提示规则、校验与发布版本" },
  generations: { title: "生成记录", subtitle: "任务状态、用量与失败详情" },
  approvals: { title: "素材审批", subtitle: "素材提交与审核记录" },
};

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{
    id: AdminView;
    label: string;
    description: string;
    icon: typeof Gauge;
  }>;
}> = [
  {
    label: "运行中心",
    items: [
      {
        id: "overview",
        label: "运行概览",
        description: "服务与任务健康度",
        icon: Gauge,
      },
    ],
  },
  {
    label: "AI 服务",
    items: [
      {
        id: "connections",
        label: "API 连接",
        description: "地址、模型与密钥",
        icon: Cable,
      },
      {
        id: "routes",
        label: "能力线路",
        description: "业务功能实际走向",
        icon: Route,
      },
      {
        id: "rules",
        label: "任务规则",
        description: "提示规则与版本",
        icon: FileCog,
      },
    ],
  },
  {
    label: "记录与审核",
    items: [
      {
        id: "generations",
        label: "生成记录",
        description: "任务、用量与异常",
        icon: History,
      },
      {
        id: "approvals",
        label: "素材审批",
        description: "提交与审核留痕",
        icon: ClipboardCheck,
      },
    ],
  },
];

export function AdminConsole({ initialView = "overview", user }: AdminConsoleProps) {
  const [view, setView] = useState<AdminView>(initialView);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState("");

  const initials = useMemo(() => {
    const value = user.displayName || user.username || "AD";
    return value.slice(0, 2).toUpperCase();
  }, [user.displayName, user.username]);

  const selectView = useCallback((next: AdminView) => {
    setView(next);
    setNotice("");
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const refresh = () => {
    setRefreshKey((value) => value + 1);
    setNotice(`${VIEW_META[view].title}已刷新`);
  };

  return (
    <div className="ai-admin-console" data-testid="admin-console">
      <aside className="ai-admin-sidebar">
        <div className="ai-admin-brand">
          <span className="ai-admin-brand__mark"><ShieldCheck aria-hidden /></span>
          <span className="ai-admin-brand__copy">
            <strong>Lumina Admin</strong>
            <small>系统管理控制台</small>
          </span>
        </div>

        <nav className="ai-admin-nav" aria-label="系统管理模块">
          {NAV_GROUPS.map((group) => (
            <section className="ai-admin-nav__group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="ai-admin-nav__item"
                    aria-current={active ? "page" : undefined}
                    onClick={() => selectView(item.id)}
                  >
                    <Icon aria-hidden />
                    <span><strong>{item.label}</strong><small>{item.description}</small></span>
                    <i aria-hidden />
                  </button>
                );
              })}
            </section>
          ))}
        </nav>

        <div className="ai-admin-sidebar__foot">
          <LockKeyhole aria-hidden />
          <span>仅系统管理员可访问</span>
        </div>
      </aside>

      <main className="ai-admin-main">
        <header className="ai-admin-header">
          <div className="ai-admin-header__title">
            <strong>{VIEW_META[view].title}</strong>
            <small>{VIEW_META[view].subtitle}</small>
          </div>
          <div className="ai-admin-header__actions">
            <button type="button" aria-label="刷新当前页面" onClick={refresh}>
              <RefreshCw aria-hidden />
            </button>
            <button type="button" aria-label="通知">
              <Bell aria-hidden />
            </button>
            <span className="ai-admin-avatar" aria-label={`管理员账号 ${user.displayName || user.username}`}>
              {initials}
            </span>
          </div>
        </header>

        <div className="ai-admin-content" key={`${view}-${refreshKey}`}>
          {view === "overview" ? (
            <AdminOverview onNavigate={selectView} />
          ) : view === "connections" ? (
            <ModelConnectionsView />
          ) : view === "routes" ? (
            <CapabilityRoutingView />
          ) : view === "rules" ? (
            <section className="ai-admin-view ai-admin-legacy-view">
              <div className="ai-admin-page-heading">
                <div><h1>任务规则</h1><p>规则编辑与模型线路分离，降低误操作风险</p></div>
              </div>
              <CapabilityRulesTab active />
            </section>
          ) : view === "generations" ? (
            <section className="ai-admin-view ai-admin-legacy-view">
              <div className="ai-admin-page-heading">
                <div><h1>生成记录</h1><p>按任务类型、状态、用户和项目定位异常</p></div>
              </div>
              <TextGenerationsHistoryTab active />
            </section>
          ) : (
            <section className="ai-admin-view ai-admin-legacy-view">
              <div className="ai-admin-page-heading">
                <div><h1>素材审批</h1><p>集中查看资产提交与审核留痕</p></div>
              </div>
              <AssetApprovalsHistoryTab active />
            </section>
          )}
        </div>

        {notice ? (
          <div className="ai-admin-toast" role="status" aria-live="polite">
            <CheckCircle2 aria-hidden />
            <span>{notice}</span>
          </div>
        ) : null}
      </main>
    </div>
  );
}
