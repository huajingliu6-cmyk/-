/**
 * Cross-instance gate so StrictMode remount / duplicate effects cannot start
 * two concurrent full-script (or episode) extract streams for the same key.
 * Memory only — never persisted.
 */

const inflight = new Set<string>();

export function extractInflightKey(
  projectId: string,
  episodeId: string,
): string {
  return `${projectId.trim()}::${episodeId.trim()}`;
}

/** @returns true if this caller now owns the gate */
export function tryAcquireExtractInflight(key: string): boolean {
  const normalized = key.trim();
  if (!normalized) return false;
  if (inflight.has(normalized)) return false;
  inflight.add(normalized);
  return true;
}

export function releaseExtractInflight(key: string): void {
  inflight.delete(key.trim());
}

export function hasExtractInflight(key: string): boolean {
  return inflight.has(key.trim());
}

/** Test-only */
export function clearExtractInflightForTests(): void {
  inflight.clear();
}
