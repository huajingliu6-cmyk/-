/**
 * Browser-safe helpers for script split UI (no Node crypto/fs).
 */

import { sha256Hex } from "@/projects/script/sha256-hex";
import { safeRandomUUID } from "@/lib/safe-random-id";

/** SHA-256 fingerprint of normalized episode text — matches server episodeContentFingerprint. */
export async function episodeContentFingerprintClient(
  text: string,
): Promise<string> {
  const normalized = text.replace(/\r\n/g, "\n");
  const data = new TextEncoder().encode(normalized);
  return sha256Hex(data);
}

export function createScriptSplitIdempotencyKey(): string {
  return `split_${safeRandomUUID()}`;
}

export function createScriptSplitConfirmIdempotencyKey(): string {
  return `split_confirm_${safeRandomUUID()}`;
}

/** Stable confirm key for a script source fingerprint (retry / refresh). */
export function scriptSplitConfirmIdempotencyKey(
  sourceFingerprint: string,
): string {
  return `split_confirm_${sourceFingerprint}`;
}
