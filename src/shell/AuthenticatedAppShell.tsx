"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthenticatedHeader } from "@/shell/AuthenticatedHeader";
import { GenerationBusyGuard } from "@/shell/GenerationBusyGuard";
import { useAuthUser } from "@/shell/useAuthUser";
import { APP_SHELL_ROOT } from "@/shell/nav";
import {
  ACTIVE_ENTERPRISE_EVENT,
  readActiveSpace,
  type ActiveSpace,
} from "@/enterprise/client-space";
import { resolveSpaceRedirect } from "@/enterprise/space-access";
import "@/shell/shell.css";

function ShellHeaderPlaceholder() {
  return (
    <header className="shell-header">
      <div className="shell-header__inner">
        <div className="shell-brand">
          <span
            className="inline-block h-7 w-7 rounded-md bg-white/10"
            aria-hidden
          />
          <span className="shell-brand__name text-white/40">Lumina Story</span>
        </div>
        <div className="ml-auto h-10 w-48 rounded-xl bg-white/5" aria-hidden />
      </div>
    </header>
  );
}

/**
 * 登录后应用壳层：固定 Header + 下方按路由挂载的内容出口。
 * 视频制作画布挂载在 /workflow，不在本壳层内。
 */
export function AuthenticatedAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = useAuthUser();
  const router = useRouter();
  const pathname = usePathname();
  const [activeSpace, setActiveSpace] = useState<ActiveSpace>(() => readActiveSpace());
  const isAdminConsole =
    pathname === "/app/admin" || pathname.startsWith("/app/admin/");

  useEffect(() => {
    const onSpaceChanged = (event: Event) => {
      const detail = (event as CustomEvent<ActiveSpace>).detail;
      setActiveSpace(detail ?? readActiveSpace());
    };
    window.addEventListener(ACTIVE_ENTERPRISE_EVENT, onSpaceChanged);
    return () => window.removeEventListener(ACTIVE_ENTERPRISE_EVENT, onSpaceChanged);
  }, []);

  const spaceRedirect = resolveSpaceRedirect(pathname, activeSpace);

  useEffect(() => {
    // 仅确认 guest 时踢回；loading 期间不要误判
    if (auth.status === "guest") {
      router.replace(
        `/?login=1&next=${encodeURIComponent(pathname || APP_SHELL_ROOT)}`,
      );
    }
  }, [auth.status, pathname, router]);

  useEffect(() => {
    if (auth.status === "authenticated" && spaceRedirect) {
      router.replace(spaceRedirect);
    }
  }, [auth.status, router, spaceRedirect]);

  if (auth.status === "loading") {
    return (
      <div className="shell-app flex h-full min-h-full flex-col overflow-hidden bg-[#070811]">
        <ShellHeaderPlaceholder />
        <div className="shell-outlet relative min-h-0 flex-1 overflow-hidden">
          <p className="p-6 text-sm text-white/45">正在恢复登录状态…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell-app flex h-full min-h-full flex-col overflow-hidden bg-[#070811]">
      {auth.status === "authenticated" ? (
        <>
          {isAdminConsole ? null : <AuthenticatedHeader user={auth.user} />}
          {isAdminConsole ? null : <GenerationBusyGuard />}
        </>
      ) : (
        <ShellHeaderPlaceholder />
      )}
      <div
        key={pathname}
        className="shell-outlet shell-outlet--enter relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        {auth.status === "authenticated" && !spaceRedirect ? children : null}
      </div>
    </div>
  );
}
