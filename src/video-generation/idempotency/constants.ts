/** 幂等存储常量（避免 store-registry ↔ file-store 循环依赖） */

/** 默认幂等记录保留 7 天（committed 亦不因 8 秒删除） */
export const IDEMPOTENCY_RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** submitting 超过该时间未完成 → 对账为 unknownOutcome（无 taskId）或 providerAccepted */
export const SUBMITTING_STALE_MS = 5 * 60 * 1000;

export const IDEMPOTENCY_SCOPE = "video-generation" as const;
