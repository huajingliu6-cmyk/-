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
import { APP_POST_LOGIN_PATH } from "@/shell/nav";

type Props = {
  onLoggedIn: (user: AuthUser) => void;
  showTrigger?: boolean;
};

type Mode = "login" | "register";

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
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (searchParams.get("login") !== "1") return undefined;
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
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
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      if (!busy) setOpen(false);
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

  const switchMode = (nextMode: Mode) => {
    if (busy) return;
    setMode(nextMode);
    setError("");
    setPassword("");
    setConfirmPassword("");
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { username, password }
          : { username, displayName, password, confirmPassword };
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      const payload = (
        raw.trim() ? JSON.parse(raw) : {}
      ) as { error?: string; user?: AuthUser };
      if (!response.ok) throw new Error(payload.error ?? `${mode === "login" ? "登录" : "注册"}失败`);
      if (!payload.user) throw new Error(`${mode === "login" ? "登录" : "注册"}失败`);

      submitBounce.trigger();
      if (!prefersReducedMotion()) await new Promise((resolve) => window.setTimeout(resolve, 180));

      const nextPath = nextOverrideRef.current || searchParams.get("next");
      nextOverrideRef.current = null;
      const target =
        nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
          ? nextPath
          : APP_POST_LOGIN_PATH;

      setOpen(false);
      await playLoginSuccess({
        target,
        onBeforeNavigate: () => onLoggedIn(payload.user!),
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "操作失败，请稍后重试");
      setBusy(false);
    }
  };

  const isLogin = mode === "login";

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
            setOpen((value) => !value);
          }}
          onAnimationEnd={triggerBounce.onAnimationEnd}
        >
          登录 / 注册
        </button>
      ) : null}

      {open ? (
        <form
          id={panelId}
          role="dialog"
          aria-label={isLogin ? "登录" : "注册"}
          onSubmit={(event) => void onSubmit(event)}
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(100vw-2rem,20rem)] rounded-2xl border border-white/12 bg-[rgba(12,13,22,0.96)] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
        >
          <div className="mb-4 flex rounded-lg bg-white/5 p-1" role="tablist" aria-label="账号操作">
            <button
              type="button"
              role="tab"
              aria-selected={isLogin}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs transition ${isLogin ? "bg-white/12 text-white" : "text-white/45"}`}
              onClick={() => switchMode("login")}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isLogin}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs transition ${!isLogin ? "bg-white/12 text-white" : "text-white/45"}`}
              onClick={() => switchMode("register")}
            >
              注册账号
            </button>
          </div>

          <p className="mb-3 text-[13px] text-white/55">
            {isLogin ? "登录后继续创作" : "创建账号，开始你的创作"}
          </p>

          {isLogin ? (
            <div
              className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-white/8 bg-black/20 p-1"
              role="tablist"
              aria-label={"\u767b\u5f55\u65b9\u5f0f"}
            >
              <button
                type="button"
                role="tab"
                aria-selected="true"
                className="rounded-md bg-white/12 px-3 py-2 text-xs text-white"
              >
                {"\u8d26\u53f7\u5bc6\u7801"}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected="false"
                disabled
                title={"\u77ed\u4fe1\u670d\u52a1\u63a5\u5165\u540e\u5f00\u653e"}
                className="cursor-not-allowed rounded-md px-3 py-2 text-xs text-white/30"
              >
                {"\u624b\u673a\u53f7\u767b\u5f55"}
                <span className="ml-1 text-[10px] text-white/25">
                  {"\u6682\u672a\u5f00\u653e"}
                </span>
              </button>
            </div>
          ) : null}

          {!isLogin ? (
            <label className="mb-3 block">
              <span className="mb-1 block text-[11px] text-white/45">昵称（可选）</span>
              <input
                className="w-full rounded-lg border border-white/12 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-violet-400/60"
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={busy}
              />
            </label>
          ) : null}

          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] text-white/45">
              用户名（账号，不是昵称）
            </span>
            <input
              className="w-full rounded-lg border border-white/12 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-violet-400/60"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={busy}
              autoFocus
              required
              placeholder={isLogin ? "例如 admin_test" : "至少 2 个字符"}
            />
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] text-white/45">密码</span>
            <input
              type="password"
              minLength={6}
              className="w-full rounded-lg border border-white/12 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-violet-400/60"
              autoComplete={isLogin ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              required
            />
          </label>

          {!isLogin ? (
            <label className="mb-3 block">
              <span className="mb-1 block text-[11px] text-white/45">确认密码</span>
              <input
                type="password"
                minLength={6}
                className="w-full rounded-lg border border-white/12 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-violet-400/60"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={busy}
                required
              />
            </label>
          ) : null}

          {error ? (
            <div className="mb-3 rounded-lg border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-[12px] text-rose-100" role="alert">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className={`shell-chip shell-chip--login h-10 w-full ${submitBounce.bounceClass}`}
            onAnimationEnd={submitBounce.onAnimationEnd}
          >
            {busy ? (isLogin ? "登录中…" : "注册中…") : isLogin ? "进入应用" : "创建账号"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
