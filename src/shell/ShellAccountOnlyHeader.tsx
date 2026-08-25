"use client";

import { ShellGlobalAccountBar } from "@/shell/ShellGlobalAccountBar";
import type { AuthUser } from "@/auth/types";
import "@/shell/shell.css";

type Props = {
  user: AuthUser;
};

export function ShellAccountOnlyHeader({ user }: Props) {
  return (
    <header className="shell-header shell-header--account-only">
      <div className="shell-header__inner">
        <ShellGlobalAccountBar user={user} />
      </div>
    </header>
  );
}
