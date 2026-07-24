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

function mapTaskStatus(raw: string): {
  status: GenerationJobStatus;
  progressLabel: string;
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
        progressLabel: "任务状态未知或已过期",
      };
    default:
      return {
        status: "failed",
        progressLabel: `未知状态：${raw}`,
      };
  }
}

function translateProviderError(code?: string, message?: string): string {
  if (code === "InvalidApiKey") return "百炼 API Key 无效或未提供";
  if (code === "UnsupportedOperation") {
    return "当前任务状态不允许此操作（例如仅 PENDING 可取消）";
  }
  if (message?.includes("PENDING")) {
    return "仅排队中的任务可以取消";
  }
  return message?.slice(0, 200) || code || "百炼接口返回错误";
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
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  getCapabilities() {
    return getAliyunWan27Capabilities({
      t2vModelId: this.config.t2vModelId,
      r2vModelId: this.config.r2vModelId,
    });
  }

  private baseUrl(): string {
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

    const url = `${this.baseUrl()}/api/v1/services/aigc/video-generation/video-synthesis`;
    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: this.authHeaders({ "X-DashScope-Async": "enable" }),
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as {
      output?: { task_id?: string; task_status?: string };
      code?: string;
      message?: string;
      request_id?: string;
    };

    if (!res.ok || json.code || !json.output?.task_id) {
      throw new Error(
        translateProviderError(json.code, json.message) ||
          `创建任务失败（HTTP ${res.status}）`,
      );
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
    const url = `${this.baseUrl()}/api/v1/tasks/${encodeURIComponent(providerTaskId)}`;
    const res = await this.fetchWithTimeout(url, {
      method: "GET",
      headers: this.authHeaders(),
    });

    const json = (await res.json()) as {
      output?: {
        task_id?: string;
        task_status?: string;
        video_url?: string;
        code?: string;
        message?: string;
      };
      usage?: {
        SR?: number | string;
        ratio?: string;
        output_video_duration?: number;
        duration?: number;
      };
      code?: string;
      message?: string;
    };

    const raw = json.output?.task_status ?? "UNKNOWN";
    const mapped = mapTaskStatus(raw);

    if (mapped.status === "failed") {
      return {
        providerTaskId,
        status: "failed",
        progressLabel: mapped.progressLabel,
        errorCode: json.output?.code ?? json.code ?? "PROVIDER_FAILED",
        errorMessage: translateProviderError(
          json.output?.code ?? json.code,
          json.output?.message ?? json.message,
        ),
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
    const url = `${this.baseUrl()}/api/v1/tasks/${encodeURIComponent(providerTaskId)}/cancel`;
    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: this.authHeaders(),
    });
    const json = (await res.json()) as {
      code?: string;
      message?: string;
      output?: { task_status?: string };
    };

    if (!res.ok || json.code) {
      return {
        cancelled: false,
        message: translateProviderError(json.code, json.message),
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
