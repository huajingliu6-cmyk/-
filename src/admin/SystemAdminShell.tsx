"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ADMIN_NAV_ITEMS, adminNavIdForPath } from "@/admin/nav";

export function SystemAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeId = adminNavIdForPath(pathname ?? "/app/admin");
  const active = ADMIN_NAV_ITEMS.find((item) => item.id === activeId);

  return (
    <div className="admin-page" data-testid="system-admin-page">
      <div className="admin-inner">
        <header className="admin-hero">
          <div>
            <div className="admin-kicker">SYSTEM ADMIN</div>
            <h1>系统管理</h1>
            <p>
              {active?.id === "apis"
                ? "按产品功能配置接口。填地址、密钥、模型，测试通过即可使用。"
                : "查看平台 AI 是否就绪，并管理接口、任务规则与生成记录。"}
            </p>
          </div>
        </header>
        <div className="admin-layout">
          <nav className="admin-subnav" aria-label="系统管理">
            {ADMIN_NAV_ITEMS.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                prefetch={false}
                data-testid={item.testId}
                className={item.id === activeId ? "is-active" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="admin-main">{children}</div>
        </div>
      </div>
    </div>
  );
}
