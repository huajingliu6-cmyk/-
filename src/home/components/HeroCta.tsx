"use client";

import { type AnimationEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { openHomeLoginPanel } from "@/home/lib/open-login-panel";

type CreationMode = "personal" | "enterprise";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Hero 双模式 CTA（始终显示）
 * 点击：回弹 + 重新打开右上角登录卡片（可重复）
 * 个人创作登录成功后进入应用门户壳层 /app
 */
export function HeroCta() {
  const router = useRouter();
  const pendingActionRef = useRef<null | (() => void)>(null);
  const [bouncingMode, setBouncingMode] = useState<CreationMode | null>(null);

  const playModeBounceThen = (mode: CreationMode, action: () => void) => {
    if (prefersReducedMotion()) {
      action();
      return;
    }
    pendingActionRef.current = action;
    setBouncingMode(null);
    requestAnimationFrame(() => setBouncingMode(mode));
  };

  const onPersonalClick = () => {
    playModeBounceThen("personal", () => {
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

  const onEnterpriseClick = () => {
    playModeBounceThen("enterprise", () => {
      openHomeLoginPanel();
      // TODO: 企业团队/企业工作台/团队项目创建路由尚未落地
    });
  };

  const onModeAnimationEnd = (
    event: AnimationEvent<HTMLButtonElement>,
    mode: CreationMode,
  ) => {
    if (!event.animationName.includes("home-mode-bounce")) return;
    if (bouncingMode !== mode) return;
    setBouncingMode(null);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  };

  return (
    <div
      className="home-cta-modes home-cta-modes--direct"
      role="group"
      aria-label="选择创作模式"
    >
      <div className="home-mode-shell is-visible">
        <span
          className="home-mode-shell__glow home-mode-shell__glow--personal"
          aria-hidden
        />
        <button
          type="button"
          className={`home-mode-btn home-mode-btn--personal home-mode-btn--lg${
            bouncingMode === "personal" ? " is-bounce" : ""
          }`}
          onClick={onPersonalClick}
          onAnimationEnd={(e) => onModeAnimationEnd(e, "personal")}
        >
          个人创作
        </button>
      </div>

      <div className="home-mode-shell is-visible delay-enterprise">
        <span
          className="home-mode-shell__glow home-mode-shell__glow--enterprise"
          aria-hidden
        />
        <button
          type="button"
          className={`home-mode-btn home-mode-btn--enterprise home-mode-btn--lg${
            bouncingMode === "enterprise" ? " is-bounce" : ""
          }`}
          onClick={onEnterpriseClick}
          onAnimationEnd={(e) => onModeAnimationEnd(e, "enterprise")}
        >
          企业团队
        </button>
      </div>
    </div>
  );
}
