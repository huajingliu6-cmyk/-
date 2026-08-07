"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  KeyRound,
  LogOut,
  Shield,
  UserRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { AuthUser } from "@/auth/types";
import {
  confirmGenerationLeaveIfNeeded,
  isGenerationBusy,
} from "@/shell/generation-busy";
import { useAuthSession } from "@/shell/AuthSessionProvider";

const ApiManagePanelLazy = dynamic(
  () =>
    import("@/auth/ApiManagePanel").then((mod) => ({
      default: mod.ApiManagePanel,
    })),
  { ssr: false },
);

type AuthUserMenuProps = {
  /** Prefer shell-provided user to avoid a duplicate /api/auth/me. */
  user: AuthUser;
};

export function AuthUserMenu({ user: initialUser }: AuthUserMenuProps) {
  const router = useRouter();
  const session = useAuthSession();
  const rootRef = useRef<HTMLDivElement>(null);
  const [user, setUser] = useState(initialUser);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState(
    () => initialUser.displayName || initialUser.username,
  );
  const [profileNotice, setProfileNotice] = useState("");
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setUser(initialUser);
    setDisplayName(initialUser.displayName || initialUser.username);
  }, [initialUser]);

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

  useEffect(() => {
    const onOpenApiManage = () => {
      setMenuOpen(false);
      setAccountOpen(false);
      setApiOpen(true);
    };
    window.addEventListener("lumina:open-api-manage", onOpenApiManage);
    return () =>
      window.removeEventListener("lumina:open-api-manage", onOpenApiManage);
  }, []);

  const onLogout = async () => {
    if (isGenerationBusy()) {
      await confirmGenerationLeaveIfNeeded();
      return;
    }
    setBusy(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      // 立刻清空客户端会话，避免首页仍按 authenticated 显示骨架/自动跳回 /app
      session?.applyUser(null);
      router.replace("/?login=1");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const clearPasswordFields = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
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

  const onChangePassword = async () => {
    setSavingPassword(true);
    setPasswordError("");
    setPasswordNotice("");
    try {
      if (!currentPassword) {
        throw new Error("请输入当前密码");
      }
      if (newPassword.length < 6) {
        throw new Error("新密码至少 6 个字符");
      }
      if (newPassword !== confirmPassword) {
        throw new Error("两次输入的新密码不一致");
      }
      const res = await fetch("/api/auth/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const payload = (await res.json()) as {
        user?: AuthUser;
        notice?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "修改密码失败");
      clearPasswordFields();
      setPasswordNotice(payload.notice ?? "密码已更新");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "修改密码失败");
    } finally {
      setSavingPassword(false);
    }
  };

  if (!user) return null;

  const accountDialog =
    accountOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="account-dialog__backdrop"
            onMouseDown={() => setAccountOpen(false)}
          >
            <div
              className="account-dialog__panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="account-dialog-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="account-dialog__glow" aria-hidden />
              <header className="account-dialog__header">
                <div className="account-dialog__heading">
                  <span className="account-dialog__eyebrow">ACCOUNT SETTINGS</span>
                  <h2 id="account-dialog-title" className="account-dialog__title">
                    {"账户与安全"}
                  </h2>
                  <p className="account-dialog__subtitle">
                    {"管理个人资料、登录凭证与账户安全"}
                  </p>
                </div>
                <button
                  type="button"
                  className="account-dialog__close"
                  aria-label={"关闭账户设置"}
                  onClick={() => setAccountOpen(false)}
                >
                  <X aria-hidden />
                </button>
              </header>

              <div className="account-dialog__body">
                <aside className="account-dialog__identity">
                  <div className="account-dialog__avatar" aria-hidden>
                    {(user.displayName || user.username).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="account-dialog__identity-copy">
                    <div className="account-dialog__display-name">
                      {user.displayName || user.username}
                    </div>
                    <div className="account-dialog__username">@{user.username}</div>
                  </div>
                  <span
                    className={
                      user.role === "admin"
                        ? "account-dialog__role account-dialog__role--admin"
                        : "account-dialog__role"
                    }
                  >
                    {user.role === "admin" ? "管理员" : "普通用户"}
                  </span>
                  <dl className="account-dialog__meta">
                    <div>
                      <dt>{"用户名"}</dt>
                      <dd>{user.username}</dd>
                    </div>
                    <div>
                      <dt>{"创建时间"}</dt>
                      <dd>{new Date(user.createdAt).toLocaleString()}</dd>
                    </div>
                  </dl>
                  {user.role === "admin" && (
                    <button
                      type="button"
                      className="account-dialog__button account-dialog__button--secondary account-dialog__api-button"
                      onClick={() => {
                        setAccountOpen(false);
                        setApiOpen(true);
                      }}
                    >
                      <Shield aria-hidden />
                      {"管理 API"}
                    </button>
                  )}
                </aside>

                <main className="account-dialog__settings">
                  <section className="account-dialog__section">
                    <div className="account-dialog__section-head">
                      <span className="account-dialog__section-icon">
                        <UserRound aria-hidden />
                      </span>
                      <div>
                        <h3>{"个人资料"}</h3>
                        <p>{"设置在项目中展示的名称"}</p>
                      </div>
                    </div>
                    <label className="account-dialog__field">
                      <span>{"显示名称"}</span>
                      <input
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder={"输入显示名称"}
                      />
                    </label>
                    {profileError && (
                      <div className="account-dialog__notice account-dialog__notice--error">
                        {profileError}
                      </div>
                    )}
                    {profileNotice && (
                      <div className="account-dialog__notice account-dialog__notice--success">
                        {profileNotice}
                      </div>
                    )}
                    <div className="account-dialog__actions">
                      <button
                        type="button"
                        disabled={savingProfile}
                        className="account-dialog__button account-dialog__button--primary"
                        onClick={() => void onSaveProfile()}
                      >
                        {savingProfile ? "保存中…" : "保存资料"}
                      </button>
                    </div>
                  </section>

                  <section className="account-dialog__section">
                    <div className="account-dialog__section-head">
                      <span className="account-dialog__section-icon">
                        <KeyRound aria-hidden />
                      </span>
                      <div>
                        <h3>{"修改密码"}</h3>
                        <p>{"建议定期更换密码以保护账户"}</p>
                      </div>
                    </div>
                    <div className="account-dialog__password-grid">
                      <label className="account-dialog__field account-dialog__field--wide">
                        <span>{"当前密码"}</span>
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={currentPassword}
                          onChange={(event) => setCurrentPassword(event.target.value)}
                        />
                      </label>
                      <label className="account-dialog__field">
                        <span>{"新密码"}</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          placeholder={"至少 6 个字符"}
                        />
                      </label>
                      <label className="account-dialog__field">
                        <span>{"确认新密码"}</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                        />
                      </label>
                    </div>
                    {passwordError && (
                      <div className="account-dialog__notice account-dialog__notice--error">
                        {passwordError}
                      </div>
                    )}
                    {passwordNotice && (
                      <div className="account-dialog__notice account-dialog__notice--success">
                        {passwordNotice}
                      </div>
                    )}
                    <div className="account-dialog__actions">
                      <button
                        type="button"
                        disabled={savingPassword}
                        className="account-dialog__button account-dialog__button--primary"
                        onClick={() => void onChangePassword()}
                      >
                        {savingPassword ? "更新中…" : "更新密码"}
                      </button>
                    </div>
                  </section>
                </main>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

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
          <div className="absolute right-0 top-[calc(100%+8px)] z-[1000] w-64 min-w-[240px] overflow-x-hidden overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 shadow-xl">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-900"
              onClick={() => {
                setMenuOpen(false);
                setAccountOpen(true);
                setProfileNotice("");
                setProfileError("");
                setPasswordNotice("");
                setPasswordError("");
                clearPasswordFields();
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

      {accountDialog}

      <ApiManagePanelLazy open={apiOpen} onClose={() => setApiOpen(false)} />
    </>
  );
}
