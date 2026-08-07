"use client";

import { type AnimationEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/shell/useAuthUser";
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
  const auth = useAuthUser();
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
      if (auth.status === "authenticated") {
        router.push("/app");
        return;
      }
      openHomeLoginPanel({ next: "/app" });
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