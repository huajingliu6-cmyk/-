/**
 * Dev-only extraction diagnostics (no secrets, no script body, no cookies).
 * Strip or no-op in production builds.
 */

type DiagPayload = Record<string, string | number | boolean | null | undefined>;

export function logAssetExtractDiag(
  event: string,
  payload: DiagPayload = {},
): void {
  if (process.env.NODE_ENV !== "development") return;
  console.info(`[asset-extract] ${event}`, payload);
}
