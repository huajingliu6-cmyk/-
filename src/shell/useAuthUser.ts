"use client";

import { useEffect, useState } from "react";
import type { AuthUser } from "@/auth/types";

export type AuthUserState =
  | { status: "loading"; user: null }
  | { status: "guest"; user: null }
  | { status: "authenticated"; user: AuthUser };

/** 读取 `/api/auth/me`；loading 期间不渲染登录/业务身份控件，避免闪烁 */
export function useAuthUser(): AuthUserState {
  const [state, setState] = useState<AuthUserState>({
    status: "loading",
    user: null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          if (!cancelled) setState({ status: "guest", user: null });
          return;
        }
        const payload = (await res.json()) as { user?: AuthUser | null };
        if (cancelled) return;
        if (payload.user) {
          setState({ status: "authenticated", user: payload.user });
        } else {
          setState({ status: "guest", user: null });
        }
      } catch {
        if (!cancelled) setState({ status: "guest", user: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
