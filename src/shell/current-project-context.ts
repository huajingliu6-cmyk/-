import type { ProjectFlowKind } from "@/projects/project-flow";

const LEGACY_STORAGE_KEY = "lumina-current-project-id";

const STORAGE_KEYS: Record<ProjectFlowKind, string> = {
  "full-stack": "lumina-current-project-full-stack",
  canvas: "lumina-current-project-canvas",
};

function readStorageKey(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key)?.trim() ?? "";
    return value || null;
  } catch {
    return null;
  }
}

function writeStorageKey(key: string, projectId: string): void {
  if (typeof window === "undefined") return;
  const trimmed = projectId.trim();
  if (!trimmed) return;
  try {
    window.localStorage.setItem(key, trimmed);
  } catch {
    /* ignore */
  }
}

export function readCurrentProjectId(flow: ProjectFlowKind): string | null {
  const scoped = readStorageKey(STORAGE_KEYS[flow]);
  if (scoped) return scoped;
  const legacy = readStorageKey(LEGACY_STORAGE_KEY);
  return legacy;
}

export function writeCurrentProjectId(
  projectId: string,
  flow: ProjectFlowKind,
): void {
  writeStorageKey(STORAGE_KEYS[flow], projectId);
}

export function clearCurrentProjectId(flow: ProjectFlowKind): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEYS[flow]);
  } catch {
    /* ignore */
  }
}
