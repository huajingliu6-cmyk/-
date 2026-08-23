import type {
  ImageGenerationErrorCode,
  ImageGenerationParamField,
} from "@/projects/assets/image-generation/types";
import { IMAGE_ERROR_USER_MESSAGE } from "@/projects/assets/image-generation/types";

export type MappedImageGenerationError = {
  code: ImageGenerationErrorCode;
  message: string;
  fields: ImageGenerationParamField[];
  httpStatus: number;
};

const PARAM_CODE_FIELDS: Record<string, ImageGenerationParamField> = {
  INVALID_IMAGE_MODEL: "model",
  INVALID_IMAGE_OPTIONS: "unknown",
  REFERENCE_IMAGE_REQUIRED: "referenceImages",
  REFERENCE_IMAGE_TOO_LARGE: "referenceImages",
  INVALID_REFERENCE_IMAGE: "referenceImages",
  REFERENCE_IMAGE_MIME_MISMATCH: "referenceImages",
  REFERENCE_SLOT_CONFLICT: "referenceImages",
  TOO_MANY_REFERENCE_IMAGES: "referenceImages",
  MULTI_ANGLE_REQUIRES_IMAGE_TO_IMAGE: "referenceImages",
  IMAGE_TO_IMAGE_REQUIRED: "referenceImages",
  PROMPT_REQUIRED: "prompt",
  MULTIPART_REQUIRED: "unknown",
  INVALID_ASSET_KIND: "unknown",
  INVALID_MULTI_ANGLE_MODE: "unknown",
  MULTI_ANGLE_TEMPLATE_FORBIDDEN: "prompt",
  MULTI_ANGLE_SCENE_ONLY: "unknown",
};

const CONTENT_CODES = new Set([
  "CONTENT_REJECTED",
  "VIDEO_REF_REQUIRED",
  "SD2_REJECTED",
  "PERSON_CERT_FAILED",
]);

const OFFLINE_CODES = new Set([
  "SERVICE_OFFLINE",
  "PROVIDER_UNAVAILABLE",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

/**
 * Map provider/parse errors to stable codes + safe Chinese messages.
 * Never expose stack traces or system prompts.
 */
export function mapImageGenerationError(input: {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}): MappedImageGenerationError {
  const rawCode = (input.code ?? "").trim();
  const rawMessage = (input.message ?? "").trim();
  const status = input.status ?? 500;

  if (rawCode === "INSUFFICIENT_CREDITS" || status === 402) {
    return {
      code: "INSUFFICIENT_CREDITS",
      message: IMAGE_ERROR_USER_MESSAGE.INSUFFICIENT_CREDITS,
      fields: [],
      httpStatus: 402,
    };
  }

  if (PARAM_CODE_FIELDS[rawCode]) {
    return {
      code: "INVALID_PARAMS",
      message: IMAGE_ERROR_USER_MESSAGE.INVALID_PARAMS,
      fields: [PARAM_CODE_FIELDS[rawCode]!],
      httpStatus: status >= 400 && status < 500 ? status : 400,
    };
  }

  if (CONTENT_CODES.has(rawCode) || /人物校验|真人|不支持内容|content.?policy/i.test(rawMessage)) {
    let message = IMAGE_ERROR_USER_MESSAGE.CONTENT_REJECTED;
    if (/人物|真人|person|sd2/i.test(rawMessage) || rawCode.includes("VIDEO_REF") || rawCode.includes("SD2")) {
      message = "人物校验未通过，请更换参考图或调整形象后再试。";
    } else if (/提示词|prompt|敏感|违规/i.test(rawMessage)) {
      message = "提示词包含不支持内容，请修改后重试。";
    }
    return {
      code: "CONTENT_REJECTED",
      message,
      fields: /提示词|prompt/i.test(rawMessage) ? ["prompt"] : ["referenceImages"],
      httpStatus: 422,
    };
  }

  if (
    OFFLINE_CODES.has(rawCode) ||
    status === 503 ||
    /offline|不可用|ECONNREFUSED|fetch failed/i.test(rawMessage)
  ) {
    return {
      code: "SERVICE_OFFLINE",
      message: IMAGE_ERROR_USER_MESSAGE.SERVICE_OFFLINE,
      fields: [],
      httpStatus: 503,
    };
  }

  if (/queue|排队|资源不足|capacity/i.test(rawMessage) || rawCode === "SERVICE_QUEUED") {
    return {
      code: "SERVICE_QUEUED",
      message: IMAGE_ERROR_USER_MESSAGE.SERVICE_QUEUED,
      fields: [],
      httpStatus: 503,
    };
  }

  if (status === 408 || rawCode === "TIMED_OUT" || /timeout|超时/i.test(rawMessage)) {
    return {
      code: "TIMED_OUT",
      message: IMAGE_ERROR_USER_MESSAGE.TIMED_OUT,
      fields: [],
      httpStatus: 408,
    };
  }

  if (status >= 500 || /network|网络|ECONNRESET/i.test(rawMessage)) {
    return {
      code: "NETWORK_ERROR",
      message: IMAGE_ERROR_USER_MESSAGE.NETWORK_ERROR,
      fields: [],
      httpStatus: status >= 400 ? status : 502,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: IMAGE_ERROR_USER_MESSAGE.UNKNOWN_ERROR,
    fields: [],
    httpStatus: status >= 400 ? status : 500,
  };
}
