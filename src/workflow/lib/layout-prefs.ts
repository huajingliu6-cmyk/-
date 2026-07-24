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

export function readLayoutPrefs(): WorkbenchLayoutPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT_PREFS };
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

export function writeLayoutPrefs(prefs: WorkbenchLayoutPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota
  }
}
