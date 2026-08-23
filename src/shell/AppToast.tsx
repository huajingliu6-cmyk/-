"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type AppToastTone = "info" | "success" | "warning" | "error";

export type AppToastItem = {
  id: string;
  message: string;
  tone: AppToastTone;
};

const MAX_TOASTS = 3;
const DEFAULT_MS = 3000;

function toneFromMessage(message: string): AppToastTone {
  const text = message.trim();
  if (!text) return "info";
  if (/失败|错误|无法|拒绝|未通过|禁止/.test(text)) return "error";
  if (/警告|注意|疑似/.test(text)) return "warning";
  if (/已|成功|完成|通过|复制/.test(text)) return "success";
  return "info";
}

const DEDUPE_WINDOW_MS = 2500;

export function useAppToasts() {
  const [toasts, setToasts] = useState<AppToastItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());
  const pausedRef = useRef<Set<string>>(new Set());
  const remainingRef = useRef<Map<string, number>>(new Map());
  const startedRef = useRef<Map<string, number>>(new Map());
  const recentMessagesRef = useRef<Map<string, number>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const handle = timersRef.current.get(id);
    if (handle != null) {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      pausedRef.current.delete(id);
      remainingRef.current.delete(id);
      startedRef.current.delete(id);
      setToasts((prev) => prev.filter((item) => item.id !== id));
    },
    [clearTimer],
  );

  const armTimer = useCallback(
    (id: string, ms: number) => {
      clearTimer(id);
      remainingRef.current.set(id, ms);
      startedRef.current.set(id, Date.now());
      const handle = window.setTimeout(() => dismiss(id), ms);
      timersRef.current.set(id, handle);
    },
    [clearTimer, dismiss],
  );

  const pushToast = useCallback(
    (message: string, tone?: AppToastTone) => {
      const text = String(message ?? "").trim();
      if (!text) return;
      // Never surface raw English parse exceptions / empty-JSON parse noise.
      const safe = /Unexpected end of JSON input|服务器返回为空|没有返回生成结果|没有返回有效数据/i.test(
        text,
      )
        ? "服务器没有返回有效数据，请稍后重试。"
        : text;
      const now = Date.now();
      const lastShown = recentMessagesRef.current.get(safe);
      if (lastShown != null && now - lastShown < DEDUPE_WINDOW_MS) {
        return;
      }
      recentMessagesRef.current.set(safe, now);
      for (const [key, at] of recentMessagesRef.current) {
        if (now - at > DEDUPE_WINDOW_MS) recentMessagesRef.current.delete(key);
      }
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const item: AppToastItem = {
        id,
        message: safe,
        tone: tone ?? toneFromMessage(safe),
      };
      setToasts((prev) => {
        const next = [...prev, item];
        if (next.length <= MAX_TOASTS) return next;
        const dropped = next.slice(0, next.length - MAX_TOASTS);
        for (const old of dropped) {
          clearTimer(old.id);
          pausedRef.current.delete(old.id);
          remainingRef.current.delete(old.id);
          startedRef.current.delete(old.id);
        }
        return next.slice(-MAX_TOASTS);
      });
      armTimer(id, DEFAULT_MS);
    },
    [armTimer, clearTimer],
  );

  const pause = useCallback((id: string) => {
    if (pausedRef.current.has(id)) return;
    const started = startedRef.current.get(id);
    const remaining = remainingRef.current.get(id) ?? DEFAULT_MS;
    if (started != null) {
      const left = Math.max(250, remaining - (Date.now() - started));
      remainingRef.current.set(id, left);
    }
    pausedRef.current.add(id);
    const handle = timersRef.current.get(id);
    if (handle != null) {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
  }, []);

  const resume = useCallback(
    (id: string) => {
      if (!pausedRef.current.has(id)) return;
      pausedRef.current.delete(id);
      armTimer(id, remainingRef.current.get(id) ?? DEFAULT_MS);
    },
    [armTimer],
  );

  useEffect(() => {
    return () => {
      for (const handle of timersRef.current.values()) {
        window.clearTimeout(handle);
      }
      timersRef.current.clear();
    };
  }, []);

  return { toasts, pushToast, dismiss, pause, resume };
}

type HostProps = {
  toasts: AppToastItem[];
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
};

export function AppToastHost({
  toasts,
  onDismiss,
  onPause,
  onResume,
}: HostProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="app-toast-viewport" data-testid="app-toast-viewport">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`app-toast app-toast--${toast.tone}`}
          data-testid="app-toast"
          data-tone={toast.tone}
          role={toast.tone === "error" ? "alert" : "status"}
          aria-live={toast.tone === "error" ? "assertive" : "polite"}
          onMouseEnter={() => onPause(toast.id)}
          onMouseLeave={() => onResume(toast.id)}
          onClick={() => onDismiss(toast.id)}
        >
          {toast.message}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Bridge: treat empty string as clear-noop for legacy setNote("") callers. */
export function makeStatusPusher(
  pushToast: (message: string, tone?: AppToastTone) => void,
): (message: string) => void {
  return (message: string) => {
    const text = String(message ?? "").trim();
    if (!text) return;
    pushToast(text);
  };
}

export function AppToastProvider({
  children,
  pushRef,
}: {
  children: ReactNode;
  pushRef?: React.MutableRefObject<((message: string) => void) | null>;
}) {
  const { toasts, pushToast, dismiss, pause, resume } = useAppToasts();
  const push = makeStatusPusher(pushToast);
  useEffect(() => {
    if (pushRef) pushRef.current = push;
  }, [push, pushRef]);
  return (
    <>
      {children}
      <AppToastHost
        toasts={toasts}
        onDismiss={dismiss}
        onPause={pause}
        onResume={resume}
      />
    </>
  );
}
