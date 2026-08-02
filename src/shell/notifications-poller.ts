import type { AppNotification } from "@/notifications/types";

export type NotificationsSnapshot = {
  notifications: AppNotification[];
  unreadCount: number;
};

type Listener = (snapshot: NotificationsSnapshot) => void;

const POLL_MS = 60_000;
/** Remount / StrictMode 短窗口内不重复打网 */
const MIN_FETCH_GAP_MS = 15_000;
/** 强制刷新也合并短连点，避免铃铛连点打爆 */
const FORCE_MIN_GAP_MS = 2_000;

type PollerState = {
  listeners: Set<Listener>;
  snapshot: NotificationsSnapshot;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  lastFetchedAt: number;
  visibilityBound: boolean;
  /** 同步互斥，避免 await 前并发冲破 inFlight */
  gated: boolean;
};

const GLOBAL_KEY = "__ic_notifications_poller_v2__";

function getState(): PollerState {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: PollerState;
  };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      listeners: new Set(),
      snapshot: { notifications: [], unreadCount: 0 },
      timer: null,
      inFlight: null,
      lastFetchedAt: 0,
      visibilityBound: false,
      gated: false,
    };
  }
  return g[GLOBAL_KEY]!;
}

async function fetchOnce(force: boolean): Promise<void> {
  const state = getState();
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }
  const now = Date.now();
  const minGap = force ? FORCE_MIN_GAP_MS : MIN_FETCH_GAP_MS;
  if (now - state.lastFetchedAt < minGap) {
    return;
  }
  if (state.inFlight) {
    await state.inFlight;
    return;
  }
  if (state.gated) return;
  state.gated = true;

  state.inFlight = (async () => {
    try {
      // 再检查一次：并发请求合并到同一 flight
      if (Date.now() - state.lastFetchedAt < minGap) {
        return;
      }
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const payload = (await res.json()) as {
        notifications?: AppNotification[];
        unreadCount?: number;
      };
      state.snapshot = {
        notifications: payload.notifications ?? [],
        unreadCount: payload.unreadCount ?? 0,
      };
      state.lastFetchedAt = Date.now();
      for (const listener of state.listeners) {
        listener(state.snapshot);
      }
    } catch {
      /* ignore transient */
    } finally {
      state.inFlight = null;
      state.gated = false;
    }
  })();

  await state.inFlight;
}

function ensureTimer() {
  const state = getState();
  if (state.timer != null) return;
  state.timer = setInterval(() => {
    void fetchOnce(false);
  }, POLL_MS);
}

function clearTimer() {
  const state = getState();
  if (state.timer == null) return;
  clearInterval(state.timer);
  state.timer = null;
}

function onVisibilityChange() {
  const state = getState();
  if (document.visibilityState === "visible" && state.listeners.size > 0) {
    void fetchOnce(false);
  }
}

function ensureVisibilityListener() {
  const state = getState();
  if (state.visibilityBound || typeof document === "undefined") return;
  document.addEventListener("visibilitychange", onVisibilityChange);
  state.visibilityBound = true;
}

function releaseVisibilityListener() {
  const state = getState();
  if (!state.visibilityBound || typeof document === "undefined") return;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  state.visibilityBound = false;
}

/**
 * 进程内单例（挂 globalThis，抗 HMR 多实例）：
 * 多组件挂载共享同一轮询，避免通知接口被打爆。
 */
export function subscribeNotifications(
  listener: Listener,
): () => void {
  const state = getState();
  state.listeners.add(listener);
  listener(state.snapshot);
  ensureVisibilityListener();
  ensureTimer();
  void fetchOnce(false);

  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size === 0) {
      clearTimer();
      releaseVisibilityListener();
    }
  };
}

/** 用户点开铃铛 / 标记已读后强制刷新（仍合并 in-flight） */
export function refreshNotifications(): Promise<void> {
  return fetchOnce(true);
}
