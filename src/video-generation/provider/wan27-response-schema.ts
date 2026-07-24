import { z } from "zod";

/**
 * 万相 2.7 / DashScope 异步任务响应 Schema（严格校验，失败时安全降级）。
 * 不保留完整敏感字段到日志。
 */

const taskStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "CANCELLED",
  "UNKNOWN",
]);

export const wan27CreateTaskResponseSchema = z.object({
  request_id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  output: z
    .object({
      task_id: z.string().min(1).optional(),
      task_status: taskStatusSchema.optional(),
    })
    .optional(),
});

export const wan27TaskStatusResponseSchema = z.object({
  request_id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  output: z
    .object({
      task_id: z.string().optional(),
      task_status: taskStatusSchema.optional(),
      video_url: z.string().optional(),
      code: z.string().optional(),
      message: z.string().optional(),
      submit_time: z.string().optional(),
      scheduled_time: z.string().optional(),
      end_time: z.string().optional(),
      orig_prompt: z.string().optional(),
    })
    .optional(),
  usage: z
    .object({
      SR: z.union([z.number(), z.string()]).optional(),
      ratio: z.string().optional(),
      duration: z.number().optional(),
      output_video_duration: z.number().optional(),
      input_video_duration: z.number().optional(),
      video_count: z.number().optional(),
    })
    .optional(),
});

export const wan27CancelResponseSchema = z.object({
  request_id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  output: z
    .object({
      task_status: taskStatusSchema.optional(),
    })
    .optional(),
});

export type Wan27CreateTaskResponse = z.infer<
  typeof wan27CreateTaskResponseSchema
>;
export type Wan27TaskStatusResponse = z.infer<
  typeof wan27TaskStatusResponseSchema
>;
export type Wan27CancelResponse = z.infer<typeof wan27CancelResponseSchema>;

export class Wan27ResponseParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "Wan27ResponseParseError";
    this.code = code;
  }
}

export async function parseJsonResponseSafe(
  res: Response,
): Promise<unknown> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!text.trim()) {
    throw new Wan27ResponseParseError(
      "PROVIDER_EMPTY_RESPONSE",
      "百炼接口返回空响应",
    );
  }
  if (
    contentType &&
    !contentType.toLowerCase().includes("json") &&
    !text.trim().startsWith("{") &&
    !text.trim().startsWith("[")
  ) {
    throw new Wan27ResponseParseError(
      "PROVIDER_NON_JSON_RESPONSE",
      "百炼接口返回了非 JSON 响应",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Wan27ResponseParseError(
      "PROVIDER_NON_JSON_RESPONSE",
      "百炼接口返回了非 JSON 响应",
    );
  }
}

export function parseCreateTaskResponse(
  raw: unknown,
): Wan27CreateTaskResponse {
  const parsed = wan27CreateTaskResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Wan27ResponseParseError(
      "PROVIDER_RESPONSE_SCHEMA_INVALID",
      "百炼创建任务响应格式无效",
    );
  }
  return parsed.data;
}

export function parseTaskStatusResponse(
  raw: unknown,
): Wan27TaskStatusResponse {
  const parsed = wan27TaskStatusResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Wan27ResponseParseError(
      "PROVIDER_RESPONSE_SCHEMA_INVALID",
      "百炼任务状态响应格式无效",
    );
  }
  return parsed.data;
}

export function parseCancelResponse(raw: unknown): Wan27CancelResponse {
  const parsed = wan27CancelResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Wan27ResponseParseError(
      "PROVIDER_RESPONSE_SCHEMA_INVALID",
      "百炼取消任务响应格式无效",
    );
  }
  return parsed.data;
}
