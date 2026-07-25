/** 本机一次性付费测试闸门常量（不硬编码模型单价） */

export const LOCAL_PAID_TEST_CONFIRMATION_PHRASE =
  "我已确认本次测试可能产生费用且只提交一次";

/** 人工确认费用上限的硬安全天花板（元），不是模型单价 */
export const LOCAL_PAID_TEST_HARD_MAX_COST_CNY = 10;

export const LOCAL_PAID_TEST_MAX_TASKS = 1;

export const LOCAL_PAID_TEST_SPEC = {
  mode: "textToVideo" as const,
  resolution: "720P" as const,
  aspectRatio: "16:9" as const,
  durationSeconds: 2 as const,
};

export const LOCAL_PAID_TEST_GUARD_FILE_NAME = "local-one-shot-guard.json";

export const LOCAL_PAID_TEST_COST_NOTICE =
  "费用上限来自管理员人工确认，最终费用以阿里云控制台结算为准。";

export const LOCAL_PAID_TEST_PHASE_NOTICE =
  "专用真实提交路径已接线；默认 mock / 付费关闭环境下仍禁止真实调用。页面刷新后需重新 Arm。";

export const LOCAL_PAID_TEST_SUBMIT_WARNING =
  "该操作未来会创建一个可能产生费用的真实任务。";
