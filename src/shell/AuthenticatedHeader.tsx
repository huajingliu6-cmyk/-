"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { MascotMark } from "@/workflow/components/BrandMark";
import { AccountActions } from "@/shell/AccountActions";
import { AppearanceButton } from "@/shell/AppearanceProvider";
import { AuthenticatedNavigation } from "@/shell/AuthenticatedNavigation";
import { GlobalBackButton } from "@/shell/GlobalBackButton";
import { NotificationBell } from "@/shell/NotificationBell";
import { APP_SHELL_ROOT } from "@/shell/nav";
import type { AuthUser } from "@/auth/types";
import { SpaceSwitcher } from "@/enterprise/SpaceSwitcher";

type Props = {
  user: AuthUser;
};

export function AuthenticatedHeader({ user }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="shell-header">
      <div className="shell-header__inner">
        <GlobalBackButton />
        <Link
          href={APP_SHELL_ROOT}
          className="shell-brand"
          aria-label="回到应用门户"
        >
          <MascotMark size={40} className="shell-brand__mark opacity-100" />
          <span className="shell-brand__name">Lumina Story</span>
        </Link>

        <AuthenticatedNavigation
          user={user}
          onNavigate={() => setMenuOpen(false)}
        />

        <div className="shell-account shell-account--end">
          <AppearanceButton compact />
          <NotificationBell />
          <SpaceSwitcher />
          <AccountActions user={user} />
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/80 lg:hidden"
            aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? (
              <X className="h-4 w-4" aria-hidden />
            ) : (
              <Menu className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className="border-t border-white/10 bg-[rgba(7,8,16,0.96)] px-4 py-3 lg:hidden">
          <AuthenticatedNavigation
            user={user}
            onNavigate={() => setMenuOpen(false)}
          />
        </div>
      ) : null}
    </header>
  );
}
