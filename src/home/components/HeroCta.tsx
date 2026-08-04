"use client";

import { type AnimationEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { openHomeLoginPanel } from "@/home/lib/open-login-panel";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Hero 主 CTA（始终显示）
 * 点击：回弹 + 打开右上角登录卡片（可重复）
 * 登录成功后进入应用门户壳层 /app
 */
export function HeroCta() {
  const router = useRouter();
  const pendingActionRef = useRef<null | (() => void)>(null);
  const [isBouncing, setIsBouncing] = useState(false);

  const playBounceThen = (action: () => void) => {
    if (prefersReducedMotion()) {
      action();
      return;
    }
    pendingActionRef.current = action;
    setIsBouncing(false);
    requestAnimationFrame(() => setIsBouncing(true));
  };

  const onStartClick = () => {
    playBounceThen(() => {
      openHomeLoginPanel({ next: "/app" });
      // 已登录时 Header 无登录面板：直接进应用壳层
      void fetch("/api/auth/me")
        .then(async (res) => {
          if (!res.ok) return;
          const payload = (await res.json()) as { user?: unknown };
          if (payload.user) router.push("/app");
        })
        .catch(() => {
          // ignore
        });
    });
  };

  const onAnimationEnd = (event: AnimationEvent<HTMLButtonElement>) => {
    if (!event.animationName.includes("home-cta-bounce")) return;
    if (!isBouncing) return;
    setIsBouncing(false);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  };

  return (
    <div className="home-cta-shell">
      <span className="home-cta-shell__glow" aria-hidden />
      <button
        type="button"
        className={`home-cta-start${isBouncing ? " is-bounce" : ""}`}
        onClick={onStartClick}
        onAnimationEnd={onAnimationEnd}
      >
        开始创作
      </button>
    </div>
  );
}