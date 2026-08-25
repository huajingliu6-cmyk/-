"use client";

import Link from "next/link";
import { ChevronLeft, Film, GitBranch, Images, LayoutGrid, Sparkles, Store } from "lucide-react";
import { MascotMark } from "@/workflow/components/BrandMark";
import {
  APP_ASSET_MARKET_PATH,
  APP_PERSONAL_ASSETS_PATH,
  APP_SHELL_ROOT,
} from "@/shell/nav";
import { personalHubHref } from "@/personal/ui/personal-hub-nav";
import { useOpenCanvas } from "@/shell/use-open-canvas";
import { useOpenOneStackFlow } from "@/shell/use-open-one-stack-flow";
import "@/shell/app-sidebar.css";

export type AppSidebarView = "personal-image" | "personal-video";

export type AppSidebarActiveId =
  | AppSidebarView
  | "personal-assets"
  | "asset-market"
  | "canvas"
  | "one-stack-flow";

type AppSidebarProps = {
  activeId?: AppSidebarActiveId;
  onSelectView?: (view: AppSidebarView) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

const NAV_ITEMS: Array<{
  id: AppSidebarActiveId;
  label: string;
  icon: typeof Sparkles;
  testId: string;
  href?: string;
  action?: "canvas" | "one-stack-flow";
}> = [
  {
    id: "personal-image",
    label: "AI 生图",
    icon: Sparkles,
    testId: "app-sidebar-personal-image",
    href: personalHubHref("personal-image"),
  },
  {
    id: "personal-video",
    label: "AI 生视频",
    icon: Film,
    testId: "app-sidebar-personal-video",
    href: personalHubHref("personal-video"),
  },
  {
    id: "personal-assets",
    label: "个人素材",
    icon: Images,
    testId: "app-sidebar-personal-assets",
    href: APP_PERSONAL_ASSETS_PATH,
  },
  {
    id: "asset-market",
    label: "素材市场",
    icon: Store,
    testId: "app-sidebar-asset-market",
    href: APP_ASSET_MARKET_PATH,
  },
  {
    id: "canvas",
    label: "画布",
    icon: LayoutGrid,
    testId: "app-sidebar-canvas",
    action: "canvas",
  },
  {
    id: "one-stack-flow",
    label: "一栈式FLOW",
    icon: GitBranch,
    testId: "app-sidebar-one-stack-flow",
    action: "one-stack-flow",
  },
];

export function AppSidebar({
  activeId = "personal-image",
  onSelectView,
  collapsed = false,
  onToggleCollapsed,
}: AppSidebarProps) {
  const { openCanvas } = useOpenCanvas();
  const { openOneStackFlow } = useOpenOneStackFlow();

  return (
    <>
      <aside
        className={`app-sidebar${collapsed ? " is-collapsed" : ""}`}
        aria-label="应用导航"
        aria-hidden={collapsed}
      >
        <div className="app-sidebar__brand">
          <div className="app-sidebar__brand-row">
            <Link
              href={APP_SHELL_ROOT}
              className="app-sidebar__logo"
              aria-label="Lumina Story"
            >
              <MascotMark size={36} className="app-sidebar__logo-mark" />
              <span className="app-sidebar__logo-name">Lumina Story</span>
            </Link>
            {onToggleCollapsed ? (
              <button
                type="button"
                className="app-sidebar__collapse"
                data-testid="app-sidebar-collapse"
                aria-label={collapsed ? "展开导航栏" : "收起导航栏"}
                title={collapsed ? "展开导航" : "收起导航"}
                onClick={onToggleCollapsed}
              >
                <ChevronLeft size={16} aria-hidden />
              </button>
            ) : null}
          </div>
        </div>

        <nav className="app-sidebar__nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const className = `app-sidebar__item${
              activeId === item.id ? " is-active" : ""
            }`;

            const useHubSwitch =
              onSelectView != null &&
              (item.id === "personal-image" || item.id === "personal-video");

            if (useHubSwitch) {
              return (
                <button
                  key={item.id}
                  type="button"
                  className={className}
                  data-testid={item.testId}
                  onClick={() => onSelectView(item.id as AppSidebarView)}
                >
                  <Icon size={18} aria-hidden />
                  <span>{item.label}</span>
                </button>
              );
            }

            if (item.action === "canvas") {
              return (
                <button
                  key={item.id}
                  type="button"
                  className={className}
                  data-testid={item.testId}
                  onClick={() => void openCanvas()}
                >
                  <Icon size={18} aria-hidden />
                  <span>{item.label}</span>
                </button>
              );
            }

            if (item.action === "one-stack-flow") {
              return (
                <button
                  key={item.id}
                  type="button"
                  className={className}
                  data-testid={item.testId}
                  onClick={() => void openOneStackFlow()}
                >
                  <Icon size={18} aria-hidden />
                  <span>{item.label}</span>
                </button>
              );
            }

            return (
              <Link
                key={item.id}
                href={item.href ?? APP_SHELL_ROOT}
                className={className}
                data-testid={item.testId}
              >
                <Icon size={18} aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
