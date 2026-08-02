"use client";

import type { ReactNode } from "react";

export const inputClassName =
  "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 outline-none";

export const btnSecondaryClassName =
  "rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40";

export const btnPrimaryClassName =
  "rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-[11px] text-zinc-100 hover:bg-zinc-700 disabled:opacity-40";

type NoticeProps = {
  error?: string;
  notice?: string;
  onDismissError?: () => void;
  onDismissNotice?: () => void;
};

export function InlineNotices({
  error,
  notice,
  onDismissError,
  onDismissNotice,
}: NoticeProps) {
  return (
    <>
      {error ? (
        <div
          className="rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200"
          role="alert"
        >
          {error}
          {onDismissError ? (
            <button
              type="button"
              className="ml-2 underline opacity-70"
              onClick={onDismissError}
            >
              关闭
            </button>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          {notice}
          {onDismissNotice ? (
            <button
              type="button"
              className="ml-2 underline opacity-70"
              onClick={onDismissNotice}
            >
              关闭
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
      {children}
    </h3>
  );
}
