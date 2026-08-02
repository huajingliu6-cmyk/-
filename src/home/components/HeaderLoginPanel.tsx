"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AuthUser } from "@/auth/types";
import {
  HOME_OPEN_LOGIN_EVENT,
  type HomeOpenLoginDetail,
} from "@/home/lib/open-login-panel";
import { useLoginPortalTransition } from "@/shell/LoginPortalTransitionProvider";
import { useChipBounce } from "@/shell/useChipBounce";
import { prefersReducedMotion } from "@/shell/login-portal";

type Props = {
  onLoggedIn: (user: AuthUser) => void;
  /** 为 false 时隐藏「登录」触发按钮，仍可通过事件反复弹出卡片 */
  showTrigger?: boolean;
};

export function HeaderLoginPanel({
  onLoggedIn,
  showTrigger = true,
}: Props) {
  const searchParams = useSearchParams();
  const { playLoginSuccess } = useLoginPortalTransition();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const nextOverrideRef = useRef<string | null>(null);
  const triggerBounce = useChipBounce();
  const submitBounce = useChipBounce();

  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (searchParams.get("login") === "1") {
      const id = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [searchParams]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<HomeOpenLoginDetail>).detail;
      const next = detail?.next;
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        nextOverrideRef.current = next;
      }
      setError("");
      setOpen(true);
    };
    window.addEventListener(HOME_OPEN_LOGIN_EVENT, onOpen);
    return () => window.removeEventListener(HOME_OPEN_LOGIN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      if (busy) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, busy]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await res.json()) as {
        error?: string;
        user?: AuthUser;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "登录失败");
      }
      if (!payload.user) {
        throw new Error("登录失败");
      }

      // 阶段一：提交按钮回弹（仅成功时）
      submitBounce.trigger();
      if (!prefersReducedMotion()) {
        await new Promise((r) => window.setTimeout(r, 180));
      }

      const nextPath = nextOverrideRef.current || searchParams.get("next");
      nextOverrideRef.current = null;
      // /workflow 保留为视频制作画布；不再改写到平台工作台
      const target =
        nextPath &&
        nextPath.startsWith("/") &&
        !nextPath.startsWith("//")
          ? nextPath
          : "/app";

      setOpen(false);
      await playLoginSuccess({
        target,
        onBeforeNavigate: () => {
          onLoggedIn(payload.user!);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {showTrigger ? (
        <button
          type="button"
          className={`shell-chip shell-chip--login ${triggerBounce.bounceClass}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={busy}
          onClick={() => {
            triggerBounce.trigger();
            setOpen((v) => !v);
          }}
          onAnimationEnd={triggerBounce.onAnimationEnd}
        >
          登录
        </button>
      ) : null}

      {open ? (
        <form
          id={panelId}
          role="dialog"
          aria-label="登录"
          onSubmit={(e) => void onSubmit(e)}
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(100vw-2rem,20rem)] rounded-2xl border border-white/12 bg-[rgba(12,13,22,0.96)] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
        >
          <p className="mb-3 text-[13px] text-white/55">登录后继续创作</p>

          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] text-white/45">用户名</span>
            <input
              className="w-full rounded-lg border border-white/12 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-violet-400/60"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] text-white/45">密码</span>
            <input
              type="password"
              className="w-full rounded-lg border border-white/12 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-violet-400/60"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>

          {error ? (
            <div
              className="mb-3 rounded-lg border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-[12px] text-rose-100"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className={`shell-chip shell-chip--login h-10 w-full ${submitBounce.bounceClass}`}
            onAnimationEnd={submitBounce.onAnimationEnd}
          >
            {busy ? "登录中…" : "进入应用"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
