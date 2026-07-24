"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  KeyRound,
  LogOut,
  Shield,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ApiManagePanel } from "@/auth/ApiManagePanel";
import type { AuthUser } from "@/auth/types";

export function AuthUserMenu() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return;
        const payload = (await res.json()) as { user?: AuthUser | null };
        if (!cancelled && payload.user) {
          setUser(payload.user);
          setDisplayName(payload.user.displayName || payload.user.username);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [menuOpen]);

  const onLogout = async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const onSaveProfile = async () => {
    setSavingProfile(true);
    setProfileError("");
    setProfileNotice("");
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const payload = (await res.json()) as {
        user?: AuthUser;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "保存失败");
      if (payload.user) {
        setUser(payload.user);
        setDisplayName(payload.user.displayName);
      }
      setProfileNotice("个人资料已更新");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingProfile(false);
    }
  };

  if (!user) return null;

  return (
    <>
      <div ref={rootRef} className="relative">
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/60">
          <button
            type="button"
            className="inline-flex max-w-[8.5rem] items-center gap-1 truncate rounded-l-lg px-2 py-1 text-[11px] text-zinc-300 transition hover:bg-zinc-800"
            title="打开账户"
            onClick={() => {
              setMenuOpen((v) => !v);
              setAccountOpen(false);
            }}
          >
            {user.role === "admin" && (
              <Shield className="h-3 w-3 shrink-0 text-amber-300" />
            )}
            <span className="truncate">
              {user.displayName || user.username}
            </span>
            <ChevronDown
              className={`h-3 w-3 shrink-0 opacity-50 transition ${menuOpen ? "rotate-180" : ""}`}
            />
          </button>
          <span className="h-4 w-px bg-zinc-700/80" aria-hidden />
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-7 w-7 items-center justify-center rounded-r-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
            title="退出登录"
            onClick={() => void onLogout()}
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>

        {menuOpen && (
          <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-52 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-xl">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-900"
              onClick={() => {
                setMenuOpen(false);
                setAccountOpen(true);
                setProfileNotice("");
                setProfileError("");
              }}
            >
              <UserRound className="h-3.5 w-3.5 text-zinc-400" />
              账户与个人信息
            </button>
            {user.role === "admin" && (
              <button
                type="button"
                className="flex w-full items-center gap-2 border-t border-zinc-800 px-3 py-2.5 text-left text-xs text-amber-100 hover:bg-zinc-900"
                onClick={() => {
                  setMenuOpen(false);
                  setApiOpen(true);
                }}
              >
                <KeyRound className="h-3.5 w-3.5 text-amber-300" />
                管理 API
              </button>
            )}
          </div>
        )}
      </div>

      {accountOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          onMouseDown={() => setAccountOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-zinc-100">账户</div>
              <button
                type="button"
                className="text-xs text-zinc-500 hover:text-zinc-300"
                onClick={() => setAccountOpen(false)}
              >
                关闭
              </button>
            </div>

            <div className="mb-3 space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-300">
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">用户名</span>
                <span className="font-medium text-zinc-100">{user.username}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">角色</span>
                <span>
                  {user.role === "admin" ? "管理员" : "普通用户"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">创建时间</span>
                <span className="tabular-nums text-zinc-400">
                  {new Date(user.createdAt).toLocaleString()}
                </span>
              </div>
            </div>

            <label className="mb-3 block text-[11px] text-zinc-400">
              显示名称
              <input
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>

            {profileError && (
              <div className="mb-2 rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                {profileError}
              </div>
            )}
            {profileNotice && (
              <div className="mb-2 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
                {profileNotice}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={savingProfile}
                className="rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
                onClick={() => void onSaveProfile()}
              >
                {savingProfile ? "保存中…" : "保存资料"}
              </button>
              {user.role === "admin" && (
                <button
                  type="button"
                  className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-100 hover:bg-amber-950/50"
                  onClick={() => {
                    setAccountOpen(false);
                    setApiOpen(true);
                  }}
                >
                  管理 API
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <ApiManagePanel open={apiOpen} onClose={() => setApiOpen(false)} />
    </>
  );
}
