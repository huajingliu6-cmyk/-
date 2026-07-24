import {
  getAliyunWan27Capabilities,
  pickCapability,
} from "../model-capabilities";
import {
  buildWan27RequestFromProviderInput,
  summarizeWan27Request,
} from "../build-wan27-request";
import type {
  GenerationJobStatus,
  ProviderCancelResult,
  ProviderGenerationInput,
  ProviderStatusResult,
  ProviderSubmitResult,
} from "../types";
import {
  buildDashScopeBaseUrl,
  type VideoProviderRuntimeConfig,
} from "./config";
import type { FetchLike, VideoProvider } from "./types";
import {
  WAN27_CREATE_PATH,
  WAN27_REQUEST_TIMEOUT_MS,
  WAN27_TASK_PATH_PREFIX,
} from "./wan27-constants";
import { mapWan27ProviderError } from "./wan27-error-map";
import {
  parseCancelResponse,
  parseCreateTaskResponse,
  parseJsonResponseSafe,
  parseTaskStatusResponse,
  Wan27ResponseParseError,
} from "./wan27-response-schema";

function mapTaskStatus(raw: string): {
  status: GenerationJobStatus;
  progressLabel: string;
  errorCode?: string;
} {
  switch (raw) {
    case "PENDING":
      return { status: "queued", progressLabel: "排队中" };
    case "RUNNING":
      return { status: "processing", progressLabel: "正在生成" };
    case "SUCCEEDED":
      return { status: "downloading", progressLabel: "正在转存结果视频" };
    case "FAILED":
      return { status: "failed", progressLabel: "生成失败" };
    case "CANCELED":
    case "CANCELLED":
      return { status: "cancelled", progressLabel: "已取消" };
    case "UNKNOWN":
      return {
        status: "failed",
        progressLabel: "任务状态未知或已过期，请勿自动创建新任务",
        errorCode: "PROVIDER_TASK_UNKNOWN",
      };
    default:
      return {
        status: "failed",
        progressLabel: "收到无法识别的任务状态，已安全失败",
        errorCode: "PROVIDER_TASK_STATUS_UNRECOGNIZED",
      };
  }
}

function toUserError(
  options: Parameters<typeof mapWan27ProviderError>[0],
): Error & { code?: string; requestId?: string } {
  const mapped = mapWan27ProviderError(options);
  const err = new Error(mapped.userMessage) as Error & {
    code?: string;
    requestId?: string;
  };
  err.code = mapped.code;
  err.requestId = mapped.requestId;
  return err;
}

export class AliyunWan27VideoProvider implements VideoProvider {
  readonly id = "aliyun-wan27" as const;
  private readonly config: VideoProviderRuntimeConfig;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: {
    config: VideoProviderRuntimeConfig;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  }) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? WAN27_REQUEST_TIMEOUT_MS;
  }

  getCapabilities() {
    return getAliyunWan27Capabilities({
      t2vModelId: this.config.t2vModelId,
      r2vModelId: this.config.r2vModelId,
    });
  }

  private baseUrl(): string {
    if (!this.config.dashscopeApiKey) {
      throw toUserError({
        code: "MISSING_DASHSCOPE_API_KEY",
        context: "config",
      });
    }
    if (!this.config.t2vModelId.trim() || !this.config.r2vModelId.trim()) {
      throw toUserError({
        code: "PROVIDER_MODEL_NOT_FOUND",
        message: "model id missing",
        context: "config",
      });
    }
    return buildDashScopeBaseUrl({
      workspaceId: this.config.dashscopeWorkspaceId,
      region: this.config.dashscopeRegion,
    });
  }

  private authHeaders(extra?: Record<string, string>): HeadersInit {
    return {
      Authorization: `Bearer ${this.config.dashscopeApiKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw toUserError({
          code: "RequestTimeOut",
          message: "timeout",
          context: "submit",
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async submitGeneration(
    input: ProviderGenerationInput,
  ): Promise<ProviderSubmitResult> {
    const body = buildWan27RequestFromProviderInput(input);
    const summary = summarizeWan27Request(body);
    console.info("[aliyun-wan27] submit", JSON.stringify(summary));

    const url = `${this.baseUrl()}${WAN27_CREATE_PATH}`;
    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: this.authHeaders({ "X-DashScope-Async": "enable" }),
      body: JSON.stringify(body),
    });

    let json: ReturnType<typeof parseCreateTaskResponse>;
    try {
      const raw = await parseJsonResponseSafe(res);
      json = parseCreateTaskResponse(raw);
    } catch (err) {
      if (err instanceof Wan27ResponseParseError) {
        throw toUserError({
          code: err.code,
          message: err.message,
          httpStatus: res.status,
        });
      }
      throw err;
    }

    if (!res.ok || json.code || !json.output?.task_id) {
      throw toUserError({
        httpStatus: res.status,
        code: json.code ?? (!json.output?.task_id ? "MISSING_TASK_ID" : undefined),
        message: json.message ?? (json.output?.task_id ? undefined : "missing task_id"),
        requestId: json.request_id,
        context: "submit",
      });
    }

    const mapped = mapTaskStatus(json.output.task_status ?? "PENDING");
    return {
      providerTaskId: json.output.task_id,
      status: mapped.status === "downloading" ? "queued" : mapped.status,
      progressLabel: mapped.progressLabel,
    };
  }

  async getGenerationStatus(
    providerTaskId: string,
  ): Promise<ProviderStatusResult> {
    const url = `${this.baseUrl()}${WAN27_TASK_PATH_PREFIX}${encodeURIComponent(providerTaskId)}`;
    const res = await this.fetchWithTimeout(url, {
      method: "GET",
      headers: this.authHeaders(),
    });

    let json: ReturnType<typeof parseTaskStatusResponse>;
    try {
      const raw = await parseJsonResponseSafe(res);
      json = parseTaskStatusResponse(raw);
    } catch (err) {
      if (err instanceof Wan27ResponseParseError) {
        return {
          providerTaskId,
          status: "failed",
          progressLabel: "任务状态响应无效",
          errorCode: err.code,
          errorMessage: mapWan27ProviderError({
            code: err.code,
            message: err.message,
          }).userMessage,
          rawTaskStatus: "UNKNOWN",
        };
      }
      throw err;
    }

    if (!res.ok && json.code) {
      const mappedErr = mapWan27ProviderError({
        httpStatus: res.status,
        code: json.code,
        message: json.message,
        requestId: json.request_id,
        context: "status",
      });
      return {
        providerTaskId,
        status: "failed",
        progressLabel: mappedErr.userMessage,
        errorCode: mappedErr.code,
        errorMessage: mappedErr.userMessage,
        rawTaskStatus: "UNKNOWN",
      };
    }

    const raw = json.output?.task_status ?? "UNKNOWN";
    const mapped = mapTaskStatus(raw);

    if (raw === "UNKNOWN") {
      const mappedErr = mapWan27ProviderError({
        code: "UNKNOWN",
        message: "task unknown or expired",
        requestId: json.request_id,
      });
      return {
        providerTaskId,
        status: "failed",
        progressLabel: mapped.progressLabel,
        errorCode: mappedErr.code,
        errorMessage: mappedErr.userMessage,
        rawTaskStatus: raw,
      };
    }

    if (mapped.status === "failed") {
      const providerCode = json.output?.code ?? json.code;
      const mappedErr = mapWan27ProviderError({
        code: providerCode,
        message: json.output?.message ?? json.message,
        requestId: json.request_id,
        context: "status",
      });
      return {
        providerTaskId,
        status: "failed",
        progressLabel: mapped.progressLabel,
        errorCode: mappedErr.code,
        errorMessage: mappedErr.userMessage,
        rawTaskStatus: raw,
      };
    }

    const sr = json.usage?.SR;
    return {
      providerTaskId,
      status: mapped.status,
      progressLabel: mapped.progressLabel,
      remoteVideoUrl: json.output?.video_url,
      providerResolution:
        sr !== undefined && sr !== null ? String(sr) : undefined,
      providerAspectRatio: json.usage?.ratio,
      providerDurationSeconds:
        json.usage?.output_video_duration ?? json.usage?.duration,
      rawTaskStatus: raw,
    };
  }

  async cancelGeneration(
    providerTaskId: string,
  ): Promise<ProviderCancelResult> {
    const url = `${this.baseUrl()}${WAN27_TASK_PATH_PREFIX}${encodeURIComponent(providerTaskId)}/cancel`;
    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: this.authHeaders(),
    });

    let json: ReturnType<typeof parseCancelResponse>;
    try {
      const raw = await parseJsonResponseSafe(res);
      json = parseCancelResponse(raw);
    } catch (err) {
      if (err instanceof Wan27ResponseParseError) {
        return {
          cancelled: false,
          message: mapWan27ProviderError({
            code: err.code,
            message: err.message,
          }).userMessage,
        };
      }
      throw err;
    }

    if (!res.ok || json.code) {
      return {
        cancelled: false,
        message: mapWan27ProviderError({
          httpStatus: res.status,
          code: json.code,
          message: json.message,
          requestId: json.request_id,
          context: "cancel",
        }).userMessage,
      };
    }

    return {
      cancelled: true,
      message: "已请求取消排队中的任务",
    };
  }
}

export function createAliyunCapability(
  config: VideoProviderRuntimeConfig,
  mode: "textToVideo" | "referenceToVideo",
) {
  return pickCapability(
    getAliyunWan27Capabilities({
      t2vModelId: config.t2vModelId,
      r2vModelId: config.r2vModelId,
    }),
    mode,
  );
}
