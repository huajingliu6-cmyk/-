/** Whole-episode prompt generation can take several minutes for large shot lists. */
export const STORYBOARD_GENERATING_STALE_MS = 10 * 60 * 1000;

/**
 * Returns true when another generate request should be rejected with 409.
 * Stale locks (crashed / aborted mid-flight) are treated as inactive so the user can retry.
 */
export function isStoryboardGeneratingLockActive(
  production: { status: string; updatedAt: string },
  nowMs: number = Date.now(),
): boolean {
  if (production.status !== "storyboard_generating") return false;
  const updatedAtMs = Date.parse(production.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return false;
  return nowMs - updatedAtMs < STORYBOARD_GENERATING_STALE_MS;
}
