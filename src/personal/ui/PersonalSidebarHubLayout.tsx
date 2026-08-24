"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  AppSidebar,
  type AppSidebarActiveId,
  type AppSidebarView,
} from "@/shell/AppSidebar";
import "@/personal/ui/personal-hub-shell.css";

const SIDEBAR_COLLAPSED_KEY = "personal-hub-sidebar-collapsed";

type PersonalSidebarHubLayoutProps = {
  activeId: AppSidebarActiveId;
  onSelectView?: (view: AppSidebarView) => void;
  children: ReactNode;
  testId?: string;
};

export function PersonalSidebarHubLayout({
  activeId,
  onSelectView,
  children,
  testId = "personal-hub-shell",
}: PersonalSidebarHubLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      setCollapsed(false);
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <div
      className={`personal-hub-shell${
        collapsed ? " personal-hub-shell--sidebar-collapsed" : ""
      }`}
      data-testid={testId}
    >
      <AppSidebar
        activeId={activeId}
        onSelectView={onSelectView}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />

      {collapsed ? (
        <button
          type="button"
          className="app-sidebar-rail"
          data-testid="app-sidebar-rail"
          aria-label="展开导航栏"
          title="点击展开导航"
          onClick={toggleCollapsed}
        >
          <ChevronRight size={16} aria-hidden />
          <span className="app-sidebar-rail__label">菜单</span>
        </button>
      ) : null}

      <div className="personal-hub-shell__main">{children}</div>
    </div>
  );
}
