type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

function limitPerMinute(): number {
  const n = Number(process.env.TEXT_GEN_RATE_LIMIT_PER_MINUTE ?? "10");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
}

/** 简单进程内滑动窗口限频 */
export function checkTextGenRateLimit(userId: string): {
  ok: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const windowMs = 60_000;
  const key = `text-gen:${userId}`;
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= limitPerMinute()) {
    const oldest = bucket.timestamps[0] ?? now;
    buckets.set(key, bucket);
    return {
      ok: false,
      retryAfterSec: Math.ceil((windowMs - (now - oldest)) / 1000),
    };
  }
  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { ok: true };
}
