const STORAGE_KEY = "lumina-current-project-id";

export function readCurrentProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
    return value || null;
  } catch {
    return null;
  }
}

export function writeCurrentProjectId(projectId: string): void {
  if (typeof window === "undefined") return;
  const trimmed = projectId.trim();
  if (!trimmed) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, trimmed);
  } catch {
    /* ignore */
  }
}

export function clearCurrentProjectId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
