"use client";

import type { ReactNode } from "react";
import { AccountActions } from "@/shell/AccountActions";
import { AppearanceButton } from "@/shell/AppearanceProvider";
import { NotificationBell } from "@/shell/NotificationBell";
import { SpaceSwitcher } from "@/enterprise/SpaceSwitcher";
import type { AuthUser } from "@/auth/types";

type Props = {
  user: AuthUser;
  trailing?: ReactNode;
};

export function ShellGlobalAccountBar({ user, trailing = null }: Props) {
  return (
    <div
      className="shell-account shell-account--end"
      data-testid="shell-global-account-bar"
    >
      <AppearanceButton compact />
      <NotificationBell />
      <SpaceSwitcher />
      <AccountActions user={user} />
      {trailing}
    </div>
  );
}
