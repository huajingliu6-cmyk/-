/**
 * Browser-safe helpers for script split UI (no Node crypto/fs).
 */

/** SHA-256 fingerprint of normalized episode text — matches server episodeContentFingerprint. */
export async function episodeContentFingerprintClient(
  text: string,
): Promise<string> {
  const normalized = text.replace(/\r\n/g, "\n");
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createScriptSplitIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `split_${crypto.randomUUID()}`;
  }
  return `split_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createScriptSplitConfirmIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `split_confirm_${crypto.randomUUID()}`;
  }
  return `split_confirm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
