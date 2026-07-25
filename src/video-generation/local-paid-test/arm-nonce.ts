import { createHash, randomBytes, timingSafeEqual } from "crypto";

/** SHA-256 hex of arm nonce. Never store or log the raw nonce. */
export function hashLocalPaidTestArmNonce(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

/** High-entropy one-time arm nonce (returned once to the client). */
export function generateLocalPaidTestArmNonce(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Constant-time compare of provided nonce against stored SHA-256 hash.
 * Does not log or echo the nonce.
 */
export function verifyLocalPaidTestArmNonce(
  provided: string,
  storedHash: string | null | undefined,
): boolean {
  if (!provided || !storedHash) return false;
  const computed = hashLocalPaidTestArmNonce(provided);
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(storedHash, "utf8");
  if (a.length !== b.length) {
    const padded = Buffer.alloc(b.length);
    a.copy(padded, 0, 0, Math.min(a.length, b.length));
    timingSafeEqual(padded, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
