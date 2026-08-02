"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatedHeroBackground } from "@/home/components/AnimatedHeroBackground";
import { HeroSection } from "@/home/components/HeroSection";
import { ShowcaseStrip } from "@/home/components/ShowcaseStrip";
import { PublicHeader } from "@/shell/PublicHeader";
import { useAuthUser } from "@/shell/useAuthUser";
import { APP_SHELL_ROOT } from "@/shell/nav";
import type { AuthUser } from "@/auth/types";
import "@/home/home.css";
import "@/shell/shell.css";

function NeutralHeader() {
  return (
    <header className="shell-header">
      <div className="shell-header__inner">
        <div className="shell-brand">
          <span
            className="inline-block h-7 w-7 rounded-md bg-white/10"
            aria-hidden
          />
          <span className="shell-brand__name text-white/40">智能视频工作台</span>
        </div>
        <div className="ml-auto h-10 w-28 rounded-xl bg-white/5" aria-hidden />
      </div>
    </header>
  );
}

export function HomeChrome() {
  const auth = useAuthUser();
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);

  const onLoggedIn = useCallback((user: AuthUser) => {
    setSessionUser(user);
  }, []);

  // 已登录访问营销首页 → 进入空白应用壳层（登录穿梭自行导航时除外）
  useEffect(() => {
    if (auth.status !== "authenticated") return;
    if (sessionUser) return; // 主动登录成功：由穿梭动画导航到 /app
    router.replace(APP_SHELL_ROOT);
  }, [auth.status, sessionUser, router]);

  return (
    <div className="home-page relative h-full min-h-full overflow-x-hidden overflow-y-auto">
      <AnimatedHeroBackground />
      <div className="relative z-10 flex min-h-full flex-col">
        {auth.status === "loading" || auth.status === "authenticated" ? (
          <NeutralHeader />
        ) : (
          <PublicHeader onLoggedIn={onLoggedIn} />
        )}
        <main className="flex flex-1 flex-col">
          <HeroSection />
          <ShowcaseStrip />
        </main>
      </div>
    </div>
  );
}
