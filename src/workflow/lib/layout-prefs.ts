import type {
  WorkbenchLayoutPrefs,
} from '../types';

export const DEFAULT_LAYOUT_PREFS: WorkbenchLayoutPrefs = {
  layoutMode: 'canvas',
  dockPosition: 'top',
  nodeDensity: 'free',
  assetPanelCollapsed: false,
  shotBarCollapsed: false,
};

const listeners = new Set<() => void>();
let clientSnapshot: WorkbenchLayoutPrefs = { ...DEFAULT_LAYOUT_PREFS };

function emitLayoutPrefs() {
  for (const listener of listeners) listener();
}

export function subscribeLayoutPrefs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getLayoutPrefsSnapshot(): WorkbenchLayoutPrefs {
  return clientSnapshot;
}

export function getServerLayoutPrefsSnapshot(): WorkbenchLayoutPrefs {
  return DEFAULT_LAYOUT_PREFS;
}

export function readLayoutPrefs(): WorkbenchLayoutPrefs {
  return { ...clientSnapshot };
}

export function writeLayoutPrefs(prefs: WorkbenchLayoutPrefs) {
  clientSnapshot = { ...prefs };
  emitLayoutPrefs();
}
