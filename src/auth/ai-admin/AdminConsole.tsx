"use client";

import { useCallback, useState, Suspense } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { CapabilityRoutingView } from "@/auth/ai-admin/CapabilityRoutingView";
import { ModelConnectionsView } from "@/auth/ai-admin/ModelConnectionsView";
import { MaterialsAdminPage } from "@/materials/ui/MaterialsAdminPage";
import { SystemVoicesAdminPanel } from "@/projects/assets/SystemVoicesAdminPanel";
import type { AuthUser } from "@/auth/types";
import { APP_SHELL_ROOT } from "@/shell/nav";
import {
  adminPrimaryView,
  type AdminPrimaryView,
  type AdminView,
  resolveAdminInitialView,
} from "@/auth/ai-admin/admin-view";
import "@/auth/ai-admin/admin-console.css";
import "@/materials/materials.css";

export type { AdminView };
export { resolveAdminInitialView };

type AdminConsoleProps = {
  initialView?: AdminView;
  user: AuthUser;
};

const VIEW_META: Record<AdminPrimaryView, { title: string; subtitle: string }> =
  {
    api: { title: "API 配置", subtitle: "模型接入、能力线路与配置状态" },
    materials: { title: "素材管理", subtitle: "公共素材目录与系统音色" },
  };

const ADMIN_TOP_TABS: Array<{
  id: AdminPrimaryView;
  label: string;
  testId: string;
}> = [
  { id: "api", label: "API 配置", testId: "admin-primary-api" },
  { id: "materials", label: "素材管理", testId: "admin-primary-materials" },
];

export function AdminConsole({
  initialView = "api",
  user: _user,
}: AdminConsoleProps) {
  const [view, setView] = useState<AdminView>(initialView);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState("");
  const primary = adminPrimaryView(view);

  const selectPrimary = useCallback((next: AdminPrimaryView) => {
    setView(next);
    setNotice("");
    const url = new URL(window.location.href);
    url.pathname = "/app/admin";
    url.searchParams.set("view", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const refresh = () => {
    setRefreshKey((value) => value + 1);
    setNotice(`${VIEW_META[primary].title}已刷新`);
  };

  return (
    <div className="ai-admin-console" data-testid="admin-console">
      <aside className="ai-admin-sidebar">
        <Link
          href={APP_SHELL_ROOT}
          className="ai-admin-brand"
          aria-label="返回主界面"
        >
          <span className="ai-admin-brand__mark">
            <ShieldCheck aria-hidden />
          </span>
          <span className="ai-admin-brand__copy">
            <strong>Lumina Admin</strong>
            <small>系统配置中心</small>
          </span>
        </Link>

        <nav
          className="ai-admin-top-tabs"
          aria-label="系统配置主模块"
          data-testid="admin-primary-tabs"
        >
          {ADMIN_TOP_TABS.map((tab) => {
            const active = primary === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`ai-admin-top-tab${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                data-testid={tab.testId}
                onClick={() => selectPrimary(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="ai-admin-sidebar__foot">
          <LockKeyhole aria-hidden />
          <span>仅系统管理员可访问</span>
        </div>
      </aside>

      <main className="ai-admin-main">
        <header className="ai-admin-header">
          <div className="ai-admin-header__title">
            <strong>{VIEW_META[primary].title}</strong>
            <small>{VIEW_META[primary].subtitle}</small>
          </div>
          <div className="ai-admin-header__actions">
            <Link
              href={APP_SHELL_ROOT}
              className="ai-admin-back-link"
              aria-label="返回主界面"
              data-testid="admin-back-to-app"
            >
              <ArrowLeft aria-hidden />
              <span>返回主界面</span>
            </Link>
            <button type="button" aria-label="刷新当前页面" onClick={refresh}>
              <RefreshCw aria-hidden />
            </button>
          </div>
        </header>

        <div className="ai-admin-content" key={`${primary}-${refreshKey}`}>
          {primary === "materials" ? (
            <section
              className="ai-admin-view ai-admin-materials-view"
              data-testid="admin-materials-view"
            >
              <Suspense
                fallback={
                  <div className="me-page">
                    <div className="me-loading">加载中…</div>
                  </div>
                }
              >
                <MaterialsAdminPage />
              </Suspense>
              <SystemVoicesAdminPanel />
            </section>
          ) : (
            <section
              className="ai-admin-view ai-admin-api-view"
              data-testid="admin-api-view"
            >
              <ModelConnectionsView
                onNavigate={(next) => {
                  if (next === "routes") {
                    document
                      .getElementById("admin-capability-routing")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
              />
              <div id="admin-capability-routing">
                <CapabilityRoutingView />
              </div>
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
