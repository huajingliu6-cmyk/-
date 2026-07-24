import { timingSafeEqual } from "crypto";
import { LOCAL_PAID_TEST_CONFIRMATION_PHRASE } from "./constants";
import { LocalPaidTestError } from "./errors";

/**
 * 恒定时间比较 Token。
 * 先比较字节长度，再 timingSafeEqual；不记录明文。
 */
export function verifyLocalPaidTestToken(
  provided: string,
  expected: string,
): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) {
    const padded = Buffer.alloc(b.length);
    a.copy(padded, 0, 0, Math.min(a.length, b.length));
    timingSafeEqual(padded, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function assertValidLocalPaidTestToken(
  provided: string,
  expected: string,
): void {
  if (!expected.trim()) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_TOKEN_NOT_CONFIGURED");
  }
  if (!verifyLocalPaidTestToken(provided, expected)) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_TOKEN_INVALID");
  }
}

export function assertValidConfirmationPhrase(phrase: string): void {
  const a = Buffer.from(phrase.trim(), "utf8");
  const b = Buffer.from(LOCAL_PAID_TEST_CONFIRMATION_PHRASE, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_CONFIRMATION_INVALID");
  }
}
