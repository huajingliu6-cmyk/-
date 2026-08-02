"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AUTH_NAV_ITEMS, type ShellNavItem } from "@/shell/nav";
import { prefersReducedMotion } from "@/shell/login-portal";

export function AuthenticatedNavigation({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [bounceId, setBounceId] = useState<string | null>(null);
  // 导航必须来自服务端；加载前仅显示工作台，避免越权菜单闪现
  const [items, setItems] = useState<ShellNavItem[]>(() =>
    AUTH_NAV_ITEMS.filter((item) => item.id === "workspace"),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/navigation");
        if (!res.ok) return;
        const payload = (await res.json()) as { navigation?: ShellNavItem[] };
        if (!cancelled && Array.isArray(payload.navigation)) {
          setItems(payload.navigation);
        }
      } catch {
        /* keep workspace-only until server responds */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const bounce = (id: string) => {
    if (prefersReducedMotion()) return;
    setBounceId(null);
    requestAnimationFrame(() => setBounceId(id));
  };

  return (
    <nav className="shell-nav" aria-label="业务导航">
      {items.map((item) => {
        const active = isActive(item.href);
        const className = [
          "shell-nav__item",
          active ? "is-active" : "",
          bounceId === item.id ? "is-bounce" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <Link
            key={item.id}
            href={item.href}
            className={className}
            onClick={() => {
              bounce(item.id);
              onNavigate?.();
            }}
            onAnimationEnd={() => {
              if (bounceId === item.id) setBounceId(null);
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
