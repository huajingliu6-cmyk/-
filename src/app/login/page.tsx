"use client";

import { type FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandMark } from "@/workflow/components/BrandMark";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";

  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "登录失败");
      }
      router.replace(nextPath.startsWith("/") ? nextPath : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-full w-full items-center justify-center overflow-hidden bg-[#0b0f14] px-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.12), transparent 40%), radial-gradient(circle at 80% 70%, rgba(52,211,153,0.08), transparent 35%), linear-gradient(180deg, #0b0f14 0%, #111827 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "radial-gradient(circle, #334155 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-zinc-700/80 bg-zinc-900/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark size={40} />
          <h1 className="mt-3 text-lg font-semibold tracking-tight text-zinc-100">
            智能视频工作台
          </h1>
          <p className="mt-1 text-xs text-zinc-500">登录后继续创作</p>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] text-zinc-400">用户名</span>
          <input
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-[11px] text-zinc-400">密码</span>
          <input
            type="password"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>

        {error && (
          <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-zinc-100 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:opacity-50"
        >
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center bg-[#0b0f14] text-sm text-zinc-500">
          加载中…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
