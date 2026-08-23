"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AuthUser } from "@/auth/types";
import { AUTH_NAV_ITEMS, type ShellNavItem } from "@/shell/nav";
import { navigationForSpace } from "@/shell/space-navigation";
import { prefersReducedMotion } from "@/shell/login-portal";
import { memoryFetch } from "@/shell/memory-fetch";
import {
  confirmGenerationLeaveIfNeeded,
  isGenerationBusy,
} from "@/shell/generation-busy";
import {
  ACTIVE_ENTERPRISE_EVENT,
  readActiveSpace,
  type ActiveSpace,
} from "@/enterprise/client-space";

export function AuthenticatedNavigation({
  onNavigate,
  user,
}: {
  onNavigate?: () => void;
  user?: AuthUser;
}) {
  const pathname = usePathname();
  const [bounceId, setBounceId] = useState<string | null>(null);
  const [items, setItems] = useState<ShellNavItem[] | null>(() =>
    user?.role === "admin" ? AUTH_NAV_ITEMS : null,
  );
  const [activeSpace, setActiveSpace] = useState<ActiveSpace>(() =>
    readActiveSpace(),
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await memoryFetch("/api/auth/navigation", {
          signal: controller.signal,
        });
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as { navigation?: ShellNavItem[] };
        if (!cancelled && Array.isArray(payload.navigation)) {
          setItems(payload.navigation);
        }
      } catch (error) {
        // Remount after Strict Mode abort should still receive nav from the
        // shared memoryFetch; ignore abort noise and keep current fallback.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const onSpaceChanged = (event: Event) => {
      const detail = (event as CustomEvent<ActiveSpace>).detail;
      setActiveSpace(detail ?? readActiveSpace());
    };
    window.addEventListener(ACTIVE_ENTERPRISE_EVENT, onSpaceChanged);
    return () => window.removeEventListener(ACTIVE_ENTERPRISE_EVENT, onSpaceChanged);
  }, []);

  const visibleItems = navigationForSpace(activeSpace, items);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const bounce = (id: string) => {
    if (prefersReducedMotion()) return;
    setBounceId(null);
    requestAnimationFrame(() => setBounceId(id));
  };

  return (
    <nav className="shell-nav" aria-label="业务导航">
      {visibleItems.map((item) => {
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
            prefetch={false}
            className={className}
            onClick={(event) => {
              if (isGenerationBusy()) {
                event.preventDefault();
                void confirmGenerationLeaveIfNeeded(item.href);
                return;
              }
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
