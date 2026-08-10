"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACTIVE_ENTERPRISE_EVENT,
  readActiveSpace,
} from "@/enterprise/client-space";

export type CreditsState =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
      status: "ready";
      balance: number;
      frozen: number;
      updatedAt?: string;
    };

export type UseCreditsResult = CreditsState & {
  refresh: () => void;
};

export function useCredits(): UseCreditsResult {
  const [state, setState] = useState<CreditsState>({ status: "loading" });
  const [epoch, setEpoch] = useState(0);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(() => {
    setEpoch((n) => n + 1);
  }, []);

  useEffect(() => {
    const onRefresh = () => setEpoch((n) => n + 1);
    window.addEventListener("ic-credits-refresh", onRefresh);
    window.addEventListener(ACTIVE_ENTERPRISE_EVENT, onRefresh);
    return () => {
      window.removeEventListener("ic-credits-refresh", onRefresh);
      window.removeEventListener(ACTIVE_ENTERPRISE_EVENT, onRefresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!hasLoadedRef.current) {
      setState({ status: "loading" });
    }
    void (async () => {
      try {
        const space = readActiveSpace();
        const query =
          space.kind === "enterprise"
            ? `?enterpriseId=${encodeURIComponent(space.enterpriseId)}`
            : "";
        const res = await fetch(`/api/credits${query}`);
        if (!res.ok) {
          if (!cancelled) {
            hasLoadedRef.current = true;
            setState({ status: "unavailable" });
          }
          return;
        }
        const payload = (await res.json()) as {
          balance?: number;
          frozen?: number;
          updatedAt?: string;
        };
        if (cancelled) return;
        hasLoadedRef.current = true;
        if (typeof payload.balance === "number") {
          setState({
            status: "ready",
            balance: payload.balance,
            frozen:
              typeof payload.frozen === "number" &&
              Number.isFinite(payload.frozen)
                ? Math.max(0, Math.floor(payload.frozen))
                : 0,
            updatedAt: payload.updatedAt,
          });
        } else {
          setState({ status: "unavailable" });
        }
      } catch {
        if (!cancelled) {
          hasLoadedRef.current = true;
          setState({ status: "unavailable" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [epoch]);

  return { ...state, refresh };
}

export function formatCreditsBalance(balance: number): string {
  return balance.toLocaleString("zh-CN");
}
