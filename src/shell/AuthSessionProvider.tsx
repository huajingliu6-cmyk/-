"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthUser } from "@/auth/types";
import type { AuthUserState } from "@/shell/useAuthUser";

type AuthSessionContextValue = AuthUserState & {
  refresh: () => Promise<void>;
  /** 登录/注册成功后立刻写入会话，避免导航到 /app 时仍是 guest 被踢回 */
  applyUser: (user: AuthUser | null) => void;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

/** In-flight /api/auth/me merge — memory only, never persisted. */
let sharedMePromise: Promise<AuthUser | null> | null = null;

function abortedError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/**
 * Shared /api/auth/me fetch. Caller AbortSignals only cancel that waiter's
 * interest — they must not abort the shared request (Strict Mode remount).
 */
export function fetchAuthMeOnce(signal?: AbortSignal): Promise<AuthUser | null> {
  if (signal?.aborted) {
    return Promise.reject(abortedError());
  }

  if (!sharedMePromise) {
    sharedMePromise = (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return null;
        const text = await res.text();
        if (!text.trim()) return null;
        const payload = JSON.parse(text) as { user?: AuthUser | null };
        return payload.user ?? null;
      } catch {
        return null;
      } finally {
        sharedMePromise = null;
      }
    })();
  }

  const shared = sharedMePromise;
  if (!signal) return shared;

  return new Promise<AuthUser | null>((resolve, reject) => {
    const onAbort = () => reject(abortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    shared.then(
      (user) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          reject(abortedError());
          return;
        }
        resolve(user);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function AuthSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<AuthUserState>({
    status: "loading",
    user: null,
  });
  const mounted = useRef(true);
  /** Bumped on apply/refresh so a stale /api/auth/me cannot overwrite login/logout. */
  const epochRef = useRef(0);

  const applyUser = useCallback((user: AuthUser | null) => {
    sharedMePromise = null;
    epochRef.current += 1;
    if (!mounted.current) return;
    setState(
      user
        ? { status: "authenticated", user }
        : { status: "guest", user: null },
    );
  }, []);

  const refresh = useCallback(async () => {
    sharedMePromise = null;
    const epoch = (epochRef.current += 1);
    try {
      const user = await fetchAuthMeOnce();
      if (!mounted.current || epoch !== epochRef.current) return;
      setState(
        user
          ? { status: "authenticated", user }
          : { status: "guest", user: null },
      );
    } catch {
      if (!mounted.current || epoch !== epochRef.current) return;
      setState({ status: "guest", user: null });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const epoch = (epochRef.current += 1);
    void (async () => {
      try {
        const user = await fetchAuthMeOnce(controller.signal);
        if (!mounted.current || epoch !== epochRef.current) return;
        setState(
          user
            ? { status: "authenticated", user }
            : { status: "guest", user: null },
        );
      } catch {
        if (!mounted.current || epoch !== epochRef.current) return;
        setState({ status: "guest", user: null });
      }
    })();
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, []);

  const value = useMemo<AuthSessionContextValue>(
    () => ({ ...state, refresh, applyUser }),
    [state, refresh, applyUser],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionContextValue | null {
  return useContext(AuthSessionContext);
}
