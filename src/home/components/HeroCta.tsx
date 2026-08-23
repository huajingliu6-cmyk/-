"use client";

import { type AnimationEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/shell/useAuthUser";
import { openHomeLoginPanel } from "@/home/lib/open-login-panel";
import { APP_POST_LOGIN_PATH } from "@/shell/nav";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Hero 主 CTA（始终显示）
 * 点击：回弹 + 打开右上角登录卡片（可重复）
 * 登录成功后进入项目管理
 */
export function HeroCta() {
  const router = useRouter();
  const auth = useAuthUser();
  const [isBouncing, setIsBouncing] = useState(false);

  const playBounceThen = (action: () => void) => {
    action();
    if (prefersReducedMotion()) {
      return;
    }
    setIsBouncing(false);
    requestAnimationFrame(() => setIsBouncing(true));
  };

  const onStartClick = () => {
    playBounceThen(() => {
      if (auth.status === "authenticated") {
        router.push(APP_POST_LOGIN_PATH);
        return;
      }
      openHomeLoginPanel({ next: APP_POST_LOGIN_PATH });
    });
  };

  const onAnimationEnd = (event: AnimationEvent<HTMLButtonElement>) => {
    if (!event.animationName.includes("home-cta-bounce")) return;
    if (!isBouncing) return;
    setIsBouncing(false);
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
