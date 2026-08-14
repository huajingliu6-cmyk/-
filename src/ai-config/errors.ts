import type {
  AiCapabilityId,
  AiModelProfileSlotId,
} from "@/ai-config/capabilities";

export type AiConfigErrorCode =
  | "AI_CAPABILITY_NOT_CONFIGURED"
  | "AI_CAPABILITY_DISABLED"
  | "AI_CAPABILITY_PLANNED"
  | "AI_CAPABILITY_DEPRECATED"
  | "AI_MODEL_PROFILE_DISABLED"
  | "AI_PROVIDER_DISABLED"
  | "AI_PROVIDER_CREDENTIAL_MISSING"
  | "AI_PROVIDER_CREDENTIAL_UNAVAILABLE"
  | "AI_PROVIDER_UNSUPPORTED"
  | "AI_CAPABILITY_MODALITY_MISMATCH"
  | "AI_CONFIGURATION_INVALID"
  | "AI_CAPABILITY_UNKNOWN"
  | "AI_MODEL_UNBOUND"
  | "AI_MODEL_CONNECTION_DISABLED"
  | "AI_MODEL_SECRET_MISSING"
  | "AI_MODEL_ADAPTER_UNAVAILABLE"
  | "AI_TASK_RULE_CONFIG_INVALID"
  | "AI_TASK_RULE_NOT_PUBLISHED"
  | "AI_TASK_RULE_REVISION_CONFLICT"
  | "AI_TASK_RULE_TOO_LARGE"
  | "AI_TASK_RULE_MARKDOWN_INVALID"
  | "AI_TASK_RULE_CONTRACT_CONFLICT"
  | "AI_OUTPUT_SCHEMA_INVALID"
  | "AI_OUTPUT_BUSINESS_VALIDATION_FAILED"
  | "AI_DESIGN_PROMPT_FORMAT_INVALID"
  | "AI_PROVIDER_REQUEST_FAILED"
  | "AI_PAID_CONFIRMATION_REQUIRED";

export class AiConfigError extends Error {
  readonly code: AiConfigErrorCode;

  constructor(code: AiConfigErrorCode, message: string) {
    super(message);
    this.name = "AiConfigError";
    this.code = code;
  }
}

/** Safe message for non-admin clients. */
export function publicAiConfigErrorMessage(code: AiConfigErrorCode): string {
  switch (code) {
    case "AI_CAPABILITY_PLANNED":
      return "该功能尚在开发中。";
    case "AI_CAPABILITY_DEPRECATED":
      return "该功能已停用。";
    case "AI_CAPABILITY_NOT_CONFIGURED":
    case "AI_CAPABILITY_DISABLED":
    case "AI_MODEL_PROFILE_DISABLED":
    case "AI_PROVIDER_DISABLED":
    case "AI_PROVIDER_UNSUPPORTED":
    case "AI_CAPABILITY_MODALITY_MISMATCH":
    case "AI_CONFIGURATION_INVALID":
    case "AI_CAPABILITY_UNKNOWN":
      return "该 AI 功能尚未由系统管理员完成配置，请联系管理员。";
    case "AI_PROVIDER_CREDENTIAL_MISSING":
    case "AI_PROVIDER_CREDENTIAL_UNAVAILABLE":
    case "AI_MODEL_SECRET_MISSING":
      return "绑定的模型连接缺少有效 API Key，请到「系统管理 → API 接口」补全密钥后重试。";
    case "AI_MODEL_UNBOUND":
    case "AI_MODEL_CONNECTION_DISABLED":
    case "AI_MODEL_ADAPTER_UNAVAILABLE":
      return "AI 模型连接未就绪，请联系系统管理员。";
    case "AI_TASK_RULE_CONFIG_INVALID":
    case "AI_TASK_RULE_NOT_PUBLISHED":
    case "AI_TASK_RULE_REVISION_CONFLICT":
    case "AI_TASK_RULE_TOO_LARGE":
    case "AI_TASK_RULE_MARKDOWN_INVALID":
      return "AI 任务规则配置异常，请联系系统管理员。";
    case "AI_TASK_RULE_CONTRACT_CONFLICT":
      return "当前资产提取任务规则与固定输出格式冲突，请联系管理员修正任务规则后重试。";
    case "AI_OUTPUT_SCHEMA_INVALID":
    case "AI_OUTPUT_BUSINESS_VALIDATION_FAILED":
      return "AI 生成结果未通过校验，请稍后重试。";
    case "AI_DESIGN_PROMPT_FORMAT_INVALID":
      return "模型返回了资产提取摘录而非正式素材提示词，请重新生成。";
    case "AI_PROVIDER_REQUEST_FAILED":
      return "AI 服务请求失败，请稍后重试。";
    case "AI_PAID_CONFIRMATION_REQUIRED":
      return "该操作需要付费确认。";
  }
}

export type AiCapabilityBinding = {
  capabilityId: AiCapabilityId;
  profileSlotId: AiModelProfileSlotId | null;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
};

export type AiCapabilityAvailability = {
  capabilityId: AiCapabilityId;
  available: boolean;
  reasonCode?: AiConfigErrorCode;
  status: string;
  label: string;
};
