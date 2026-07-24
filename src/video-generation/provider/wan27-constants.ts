/** 万相 2.7 官方契约常量（不联网；价格不硬编码进业务逻辑） */

export const WAN27_CONTRACT_CHECKED_AT = "2026-07-25";

export const WAN27_CREATE_PATH =
  "/api/v1/services/aigc/video-generation/video-synthesis";

export const WAN27_TASK_PATH_PREFIX = "/api/v1/tasks/";

/** 官方建议轮询间隔约 15 秒 */
export const WAN27_RECOMMENDED_POLL_INTERVAL_MS = 15_000;

/** Mock 本地轮询可更快，不影响真实 Provider */
export const MOCK_POLL_INTERVAL_MS = 3_500;

/** 查询接口官方默认 RPS */
export const WAN27_TASK_QUERY_RPS_LIMIT = 20;

/** task_id 与结果 URL 官方有效期说明 */
export const WAN27_TASK_ID_TTL = "24h";
export const WAN27_RESULT_URL_TTL = "24h";

export const WAN27_DEFAULT_T2V_MODEL_ID = "wan2.7-t2v-2026-06-12";
export const WAN27_DEFAULT_R2V_MODEL_ID = "wan2.7-r2v-2026-06-12";

export const WAN27_PRICING_PAGE_NAME = "模型价格（大模型服务平台百炼）";
export const WAN27_PRICING_PAGE_URL =
  "https://help.aliyun.com/zh/model-studio/model-pricing";

export const WAN27_UI_COST_NOTICE =
  "预计费用请以阿里云百炼当前价格和控制台实际结算为准。";

/** Provider 请求超时（毫秒） */
export const WAN27_REQUEST_TIMEOUT_MS = 60_000;
