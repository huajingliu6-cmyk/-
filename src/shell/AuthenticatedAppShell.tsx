"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthenticatedHeader } from "@/shell/AuthenticatedHeader";
import { useAuthUser } from "@/shell/useAuthUser";
import { APP_SHELL_ROOT } from "@/shell/nav";
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

  useEffect(() => {
    if (auth.status === "guest") {
      router.replace(`/?login=1&next=${encodeURIComponent(pathname || APP_SHELL_ROOT)}`);
    }
  }, [auth.status, pathname, router]);

  return (
    <div className="shell-app flex h-full min-h-full flex-col overflow-hidden bg-[#070811]">
      {auth.status === "authenticated" ? (
        <AuthenticatedHeader user={auth.user} />
      ) : (
        <ShellHeaderPlaceholder />
      )}
      <div
        key={pathname}
        className="shell-outlet shell-outlet--enter relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        {auth.status === "authenticated" ? children : null}
      </div>
    </div>
  );
}
