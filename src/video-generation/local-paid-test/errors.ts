/** 本机一次性付费测试结构化错误（中文不暴露 Token / 密钥 / 路径 / Header） */

export const LOCAL_PAID_TEST_ERROR_MESSAGES = {
  LOCAL_PAID_TEST_DISABLED: "本机一次性付费测试未启用。",
  LOCAL_PAID_TEST_NOT_ALLOWED_IN_PRODUCTION:
    "一次性付费测试仅允许在本机开发环境中执行。",
  LOCAL_PAID_TEST_TOKEN_NOT_CONFIGURED: "一次性测试令牌尚未配置。",
  LOCAL_PAID_TEST_TOKEN_INVALID: "一次性测试令牌无效或确认信息不正确。",
  LOCAL_PAID_TEST_CONFIRMATION_INVALID: "确认短语不正确，已拒绝操作。",
  LOCAL_PAID_TEST_PRICE_NOT_CONFIRMED: "尚未完成当日价格人工确认。",
  LOCAL_PAID_TEST_PRICE_CONFIRMATION_EXPIRED:
    "价格确认日期不是当天，请重新确认后再试。",
  LOCAL_PAID_TEST_MAX_COST_INVALID: "最大费用上限无效或超出安全范围。",
  LOCAL_PAID_TEST_SPEC_NOT_ALLOWED:
    "首次付费测试只允许纯文生视频、720P、16:9、2 秒且不包含任何参考素材。",
  LOCAL_PAID_TEST_NOT_ARMED: "一次性测试尚未武装（Arm），禁止提交。",
  LOCAL_PAID_TEST_ALREADY_IN_PROGRESS:
    "一次性测试已在进行中，禁止第二次提交。",
  LOCAL_PAID_TEST_ALREADY_CONSUMED:
    "一次性测试资格已使用或已归档，禁止再次提交。",
  LOCAL_PAID_TEST_UNKNOWN_OUTCOME:
    "提交结果无法确认，为避免重复计费，一次性测试已锁定。",
  LOCAL_PAID_TEST_GUARD_CORRUPTED:
    "一次性测试守卫记录损坏，无法安全继续，请联系管理员排查。",
  LOCAL_PAID_TEST_GUARD_UNAVAILABLE: "一次性测试守卫存储暂时不可用。",
  LOCAL_PAID_TEST_ACTIVE_GENERATION_EXISTS:
    "存在进行中的生成任务，禁止武装或提交一次性测试。",
  LOCAL_PAID_TEST_LOOPBACK_REQUIRED:
    "一次性付费测试仅允许从本机环回地址发起。",
  LOCAL_PAID_TEST_ORIGIN_INVALID:
    "请求来源 Origin 无效或不匹配，已拒绝。",
  LOCAL_PAID_TEST_CSRF_REJECTED:
    "跨站请求被拒绝，请从本机同源页面操作。",
  LOCAL_PAID_TEST_PROXY_NOT_ALLOWED:
    "检测到非本机代理转发头，已拒绝本次请求。",
  LOCAL_PAID_TEST_NONCE_REQUIRED: "缺少一次性提交凭证，请重新武装后再试。",
  LOCAL_PAID_TEST_NONCE_INVALID: "一次性提交凭证无效，请重新武装后再试。",
  LOCAL_PAID_TEST_NONCE_REUSED:
    "一次性提交凭证已使用或已失效，禁止再次创建任务。",
  LOCAL_PAID_TEST_REQUEST_MISMATCH:
    "请求内容与已武装的提交凭证不匹配，已拒绝。",
  PAID_SUBMISSION_REQUIRES_LOCAL_TEST_GATE:
    "真实付费提交仅允许通过本机一次性测试入口，普通生成接口已拒绝。",
  LOCAL_PAID_TEST_CLIENT_FIELD_FORBIDDEN:
    "客户端不得指定 Provider、Endpoint、模型或远程任务字段。",
  LOCAL_PAID_TEST_CONFIRM_REQUIRED: "必须明确确认本次付费生成。",
  LOCAL_PAID_TEST_IDEMPOTENCY_REQUIRED: "必须提供有效的幂等键。",
} as const;

export type LocalPaidTestErrorCode = keyof typeof LOCAL_PAID_TEST_ERROR_MESSAGES;

export class LocalPaidTestError extends Error {
  readonly code: LocalPaidTestErrorCode;

  constructor(code: LocalPaidTestErrorCode, message?: string) {
    super(message ?? LOCAL_PAID_TEST_ERROR_MESSAGES[code]);
    this.name = "LocalPaidTestError";
    this.code = code;
  }
}

export function localPaidTestErrorMessage(code: LocalPaidTestErrorCode): string {
  return LOCAL_PAID_TEST_ERROR_MESSAGES[code];
}
