"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { MascotMark } from "@/workflow/components/BrandMark";
import { AuthenticatedNavigation } from "@/shell/AuthenticatedNavigation";
import { GlobalBackButton } from "@/shell/GlobalBackButton";
import { APP_SHELL_ROOT, isOneStackFlowPath } from "@/shell/nav";
import { useProjectFlowHeader } from "@/shell/project-flow-header-context";
import { ProjectStageNavLinks } from "@/projects/workbench/ProjectStageNavLinks";
import type { AuthUser } from "@/auth/types";
import { ShellGlobalAccountBar } from "@/shell/ShellGlobalAccountBar";
import { ShellProjectContext } from "@/shell/ShellProjectContext";
import "@/projects/workbench/workbench.css";

type Props = {
  user: AuthUser;
  variant?: "full" | "account-only";
};

function HeaderPrimaryNav({
  user,
  flowHeader,
  hideGlobalNav,
  onNavigate,
}: {
  user: AuthUser;
  flowHeader: ReturnType<typeof useProjectFlowHeader>;
  hideGlobalNav: boolean;
  onNavigate: () => void;
}) {
  if (flowHeader) {
    return (
      <ProjectStageNavLinks
        projectId={flowHeader.projectId}
        mode={flowHeader.mode}
        scriptHref={flowHeader.scriptHref}
        placement="header"
      />
    );
  }
  if (hideGlobalNav) return null;
  return <AuthenticatedNavigation user={user} onNavigate={onNavigate} />;
}

export function AuthenticatedHeader({ user, variant = "full" }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname() ?? "";
  const flowHeader = useProjectFlowHeader();
  const hideGlobalNav = isOneStackFlowPath(pathname);
  const accountOnly = variant === "account-only";

  const mobileMenuButton = !accountOnly ? (
    <button
      type="button"
      className="shell-account__menu-btn inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/80 lg:hidden"
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
  ) : null;

  return (
    <header
      className={`shell-header${
        accountOnly ? " shell-header--account-only" : ""
      }${flowHeader ? " shell-header--project-flow" : ""}`}
    >
      <div className="shell-header__inner">
        {accountOnly ? null : (
          <>
            <GlobalBackButton />
            {flowHeader ? (
              <ShellProjectContext projectName={flowHeader.projectName} />
            ) : (
              <Link
                href={APP_SHELL_ROOT}
                className="shell-brand"
                aria-label="回到应用门户"
              >
                <MascotMark
                  size={40}
                  className="shell-brand__mark opacity-100"
                />
                <span className="shell-brand__name">Lumina Story</span>
              </Link>
            )}

            <HeaderPrimaryNav
              user={user}
              flowHeader={flowHeader}
              hideGlobalNav={hideGlobalNav}
              onNavigate={() => setMenuOpen(false)}
            />
          </>
        )}

        <ShellGlobalAccountBar user={user} trailing={mobileMenuButton} />
      </div>

      {!accountOnly && menuOpen ? (
        <div className="border-t border-white/10 bg-[rgba(7,8,16,0.96)] px-4 py-3 lg:hidden">
          <HeaderPrimaryNav
            user={user}
            flowHeader={flowHeader}
            hideGlobalNav={hideGlobalNav}
            onNavigate={() => setMenuOpen(false)}
          />
        </div>
      ) : null}
    </header>
  );
}
