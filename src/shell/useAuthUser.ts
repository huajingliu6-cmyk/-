"use client";

import { useEffect, useState } from "react";
import type { AuthUser } from "@/auth/types";
import {
  fetchAuthMeOnce,
  useAuthSession,
} from "@/shell/AuthSessionProvider";

export type AuthUserState =
  | { status: "loading"; user: null }
  | { status: "guest"; user: null }
  | { status: "authenticated"; user: AuthUser };

/**
 * Shared session when AuthSessionProvider is mounted; otherwise a single
 * in-flight /api/auth/me. Never persists to Web Storage.
 */
export function useAuthUser(): AuthUserState {
  const session = useAuthSession();
  const [fallback, setFallback] = useState<AuthUserState>({
    status: "loading",
    user: null,
  });

  useEffect(() => {
    if (session) return;
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const user = await fetchAuthMeOnce(controller.signal);
        if (cancelled) return;
        setFallback(
          user
            ? { status: "authenticated", user }
            : { status: "guest", user: null },
        );
      } catch {
        if (!cancelled) setFallback({ status: "guest", user: null });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [session]);

  if (session) {
    return {
      status: session.status,
      user: session.user,
    } as AuthUserState;
  }
  return fallback;
}
