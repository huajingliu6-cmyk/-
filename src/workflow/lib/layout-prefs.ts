import type {
  NodeDensity,
  QuickCreateDockPosition,
  WorkbenchLayoutMode,
  WorkbenchLayoutPrefs,
} from "../types";

const STORAGE_KEY = "workbench-layout-prefs";

export const DEFAULT_LAYOUT_PREFS: WorkbenchLayoutPrefs = {
  layoutMode: "canvas",
  dockPosition: "top",
  nodeDensity: "free",
  assetPanelCollapsed: false,
  shotBarCollapsed: false,
};

const listeners = new Set<() => void>();

let clientSnapshot: WorkbenchLayoutPrefs = { ...DEFAULT_LAYOUT_PREFS };
let clientRaw: string | null = null;
let clientHydrated = false;

function isLayoutMode(v: unknown): v is WorkbenchLayoutMode {
  return v === "canvas" || v === "assets" || v === "storyboard";
}

function isDock(v: unknown): v is QuickCreateDockPosition {
  return v === "top" || v === "left";
}

function isDensity(v: unknown): v is NodeDensity {
  if (v === "fixed" || v === "free") return true;
  // 兼容旧「紧凑 / 舒适」
  if (v === "compact" || v === "comfortable") return true;
  return false;
}

function normalizeDensity(v: unknown): NodeDensity {
  if (v === "fixed" || v === "compact") return "fixed";
  return "free";
}

function parseLayoutPrefs(raw: string | null): WorkbenchLayoutPrefs {
  if (!raw) return { ...DEFAULT_LAYOUT_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<WorkbenchLayoutPrefs>;
    return {
      layoutMode: isLayoutMode(parsed.layoutMode)
        ? parsed.layoutMode
        : DEFAULT_LAYOUT_PREFS.layoutMode,
      dockPosition: isDock(parsed.dockPosition)
        ? parsed.dockPosition
        : DEFAULT_LAYOUT_PREFS.dockPosition,
      nodeDensity: isDensity(parsed.nodeDensity)
        ? normalizeDensity(parsed.nodeDensity)
        : DEFAULT_LAYOUT_PREFS.nodeDensity,
      assetPanelCollapsed: Boolean(parsed.assetPanelCollapsed),
      shotBarCollapsed: Boolean(parsed.shotBarCollapsed),
    };
  } catch {
    return { ...DEFAULT_LAYOUT_PREFS };
  }
}

function emitLayoutPrefs() {
  for (const listener of listeners) {
    listener();
  }
}

function syncClientSnapshotFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (clientHydrated && raw === clientRaw) {
      return clientSnapshot;
    }
    clientRaw = raw;
    clientSnapshot = parseLayoutPrefs(raw);
    clientHydrated = true;
    return clientSnapshot;
  } catch {
    clientRaw = null;
    clientSnapshot = { ...DEFAULT_LAYOUT_PREFS };
    clientHydrated = true;
    return clientSnapshot;
  }
}

/** 订阅布局偏好（同页 write + 跨 tab storage）。 */
export function subscribeLayoutPrefs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      clientHydrated = false;
      syncClientSnapshotFromStorage();
      emitLayoutPrefs();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** 客户端快照：稳定引用，供 useSyncExternalStore。 */
export function getLayoutPrefsSnapshot(): WorkbenchLayoutPrefs {
  return syncClientSnapshotFromStorage();
}

/** SSR / 首屏：与本地存储解耦，避免 hydration mismatch。 */
export function getServerLayoutPrefsSnapshot(): WorkbenchLayoutPrefs {
  return DEFAULT_LAYOUT_PREFS;
}

export function readLayoutPrefs(): WorkbenchLayoutPrefs {
  if (typeof window === "undefined") {
    return { ...DEFAULT_LAYOUT_PREFS };
  }
  return { ...syncClientSnapshotFromStorage() };
}

export function writeLayoutPrefs(prefs: WorkbenchLayoutPrefs) {
  const next = { ...prefs };
  try {
    const raw = JSON.stringify(next);
    localStorage.setItem(STORAGE_KEY, raw);
    clientRaw = raw;
    clientSnapshot = next;
    clientHydrated = true;
  } catch {
    clientSnapshot = next;
    clientHydrated = true;
  }
  emitLayoutPrefs();
}
