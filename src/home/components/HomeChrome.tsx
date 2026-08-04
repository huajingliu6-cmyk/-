"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser } from "@/auth/types";
import { AnimatedHeroBackground } from "@/home/components/AnimatedHeroBackground";
import { HeroSection } from "@/home/components/HeroSection";
import { ShowcaseStrip } from "@/home/components/ShowcaseStrip";
import { PublicHeader } from "@/shell/PublicHeader";
import { APP_SHELL_ROOT } from "@/shell/nav";
import { useAuthUser } from "@/shell/useAuthUser";
import { MascotMark } from "@/workflow/components/BrandMark";
import "@/home/home.css";
import "@/shell/shell.css";

function NeutralHeader() {
  return (
    <header className="shell-header">
      <div className="shell-header__inner">
        <div className="shell-brand">
          <MascotMark size={40} className="shell-brand__mark opacity-60" />
          <span className="shell-brand__name text-white/40">Lumina Story</span>
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

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    if (sessionUser) return;
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
