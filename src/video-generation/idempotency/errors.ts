/** 幂等与提交相关结构化错误（中文文案不暴露内部路径或密钥） */

export const IDEMPOTENCY_ERROR_MESSAGES = {
  IDEMPOTENCY_IN_PROGRESS: "相同请求正在处理中，请稍候，勿重复提交。",
  IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST:
    "幂等键被复用于不同的生成请求，已拒绝以避免错配计费。",
  GENERATION_SUBMISSION_UNKNOWN:
    "提交结果暂时无法确认，为避免重复计费，系统已暂停自动重试。",
  ACTIVE_GENERATION_ALREADY_EXISTS:
    "该镜头已有进行中的生成任务，请等待完成或结束后再提交。",
  IDEMPOTENCY_RECORD_CORRUPTED: "幂等记录损坏，无法安全继续，请联系管理员排查。",
  IDEMPOTENCY_STORE_UNAVAILABLE: "幂等存储暂时不可用，请稍后重试。",
  IDEMPOTENCY_KEY_REQUIRED: "重新生成必须提供新的幂等键。",
  DUPLICATE_CHARGE_ACK_REQUIRED:
    "上次提交结果未确认。重新生成可能产生重复计费，请确认后继续。",
} as const;

export type IdempotencyErrorCode = keyof typeof IDEMPOTENCY_ERROR_MESSAGES;

export class IdempotencyError extends Error {
  readonly code: IdempotencyErrorCode;
  readonly generationId?: string;

  constructor(
    code: IdempotencyErrorCode,
    options?: { message?: string; generationId?: string },
  ) {
    super(options?.message ?? IDEMPOTENCY_ERROR_MESSAGES[code]);
    this.name = "IdempotencyError";
    this.code = code;
    this.generationId = options?.generationId;
  }
}

/**
 * Provider 请求可能已发出，但无法确认是否接单（无 task ID）。
 * 调用方必须标记 unknownOutcome，禁止盲目自动重试。
 */
export class ProviderOutcomeUnknownError extends Error {
  readonly code = "GENERATION_SUBMISSION_UNKNOWN" as const;

  constructor(message?: string) {
    super(message ?? IDEMPOTENCY_ERROR_MESSAGES.GENERATION_SUBMISSION_UNKNOWN);
    this.name = "ProviderOutcomeUnknownError";
  }
}

export const UNKNOWN_OUTCOME_USER_MESSAGE =
  IDEMPOTENCY_ERROR_MESSAGES.GENERATION_SUBMISSION_UNKNOWN;

export const UNKNOWN_OUTCOME_ADMIN_HINT =
  "管理员排查：检查幂等记录 state=unknownOutcome、对应 generationId、Provider 控制台是否已有计费任务；勿自动重放同一幂等键；确认后可人工补写 providerTaskId 或指导用户使用新键重新生成（可能重复计费）。";
