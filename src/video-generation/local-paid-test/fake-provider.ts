import { randomUUID } from "crypto";
import type {
  ProviderCancelResult,
  ProviderCapabilities,
  ProviderGenerationInput,
  ProviderStatusResult,
  ProviderSubmitResult,
  VideoProviderId,
} from "../types";
import type { VideoProvider } from "../provider/types";
import { ProviderOutcomeUnknownError } from "../idempotency/errors";
import {
  listCapabilitiesForProvider,
} from "../model-capabilities";

export type FakeLocalPaidTestProviderBehavior =
  | "success"
  | "failBeforeAccept"
  | "unknownOutcome"
  | "providerFailed"
  | "providerCanceled"
  | "providerUnknown";

/**
 * Explicit fake / simulation Provider for zero-network integration tests.
 * Must never be used as a silent production fallback.
 */
export class FakeLocalPaidTestVideoProvider implements VideoProvider {
  readonly id: VideoProviderId = "aliyun-wan27";
  readonly isFakeLocalPaidTestProvider = true as const;
  readonly simulation = true as const;

  private submitCount = 0;
  private readonly tasks = new Map<
    string,
    {
      status: ProviderStatusResult;
    }
  >();

  constructor(
    private readonly options: {
      behavior?: FakeLocalPaidTestProviderBehavior;
      remoteVideoUrl?: string;
      t2vModelId?: string;
      r2vModelId?: string;
    } = {},
  ) {}

  getSubmitCount(): number {
    return this.submitCount;
  }

  async submitGeneration(
    input: ProviderGenerationInput,
  ): Promise<ProviderSubmitResult> {
    this.submitCount += 1;
    const behavior = this.options.behavior ?? "success";
    if (behavior === "failBeforeAccept") {
      throw Object.assign(new Error("假 Provider：提交前失败"), {
        code: "FAKE_PROVIDER_REJECTED",
      });
    }
    if (behavior === "unknownOutcome") {
      throw new ProviderOutcomeUnknownError();
    }
    const taskId = `fake-local-paid-task-${randomUUID()}`;
    let status: ProviderStatusResult = {
      providerTaskId: taskId,
      status: "queued",
      progressLabel: "假 Provider 排队",
      rawTaskStatus: "PENDING",
    };
    if (behavior === "providerFailed") {
      status = {
        providerTaskId: taskId,
        status: "failed",
        progressLabel: "假 Provider 失败",
        errorCode: "FAKE_PROVIDER_FAILED",
        errorMessage: "假 Provider 任务失败",
        rawTaskStatus: "FAILED",
      };
    } else if (behavior === "providerCanceled") {
      status = {
        providerTaskId: taskId,
        status: "cancelled",
        progressLabel: "假 Provider 已取消",
        rawTaskStatus: "CANCELED",
      };
    } else if (behavior === "providerUnknown") {
      status = {
        providerTaskId: taskId,
        status: "failed",
        progressLabel: "假 Provider UNKNOWN",
        errorCode: "PROVIDER_TASK_UNKNOWN",
        errorMessage: "任务不存在或已过期",
        rawTaskStatus: "UNKNOWN",
      };
    } else {
      status = {
        providerTaskId: taskId,
        status: "downloading",
        progressLabel: "假 Provider 成功",
        remoteVideoUrl:
          this.options.remoteVideoUrl ??
          "https://cdn.example-results.test/fake-local-paid.mp4",
        providerResolution: "720P",
        providerAspectRatio: "16:9",
        providerDurationSeconds: 2,
        rawTaskStatus: "SUCCEEDED",
      };
    }
    this.tasks.set(taskId, { status });
    void input;
    return {
      providerTaskId: taskId,
      status: behavior === "success" ? "queued" : status.status,
      progressLabel: "假 Provider 已接单",
    };
  }

  async getGenerationStatus(
    providerTaskId: string,
  ): Promise<ProviderStatusResult> {
    const found = this.tasks.get(providerTaskId);
    if (!found) {
      return {
        providerTaskId,
        status: "failed",
        progressLabel: "未知任务",
        errorCode: "PROVIDER_TASK_UNKNOWN",
        errorMessage: "任务不存在",
        rawTaskStatus: "UNKNOWN",
      };
    }
    return found.status;
  }

  async cancelGeneration(
    providerTaskId: string,
  ): Promise<ProviderCancelResult> {
    const found = this.tasks.get(providerTaskId);
    if (!found) {
      return { cancelled: false, message: "任务不存在" };
    }
    found.status = {
      ...found.status,
      status: "cancelled",
      progressLabel: "已取消",
      rawTaskStatus: "CANCELED",
    };
    return { cancelled: true, message: "已取消" };
  }

  getCapabilities(): ProviderCapabilities {
    return listCapabilitiesForProvider("aliyun-wan27", {
      t2vModelId: this.options.t2vModelId ?? "wan2.7-t2v-2026-06-12",
      r2vModelId: this.options.r2vModelId ?? "wan2.7-r2v-2026-06-12",
    });
  }
}

export function isFakeLocalPaidTestProvider(
  provider: VideoProvider,
): provider is FakeLocalPaidTestVideoProvider {
  return (
    "isFakeLocalPaidTestProvider" in provider &&
    (provider as FakeLocalPaidTestVideoProvider).isFakeLocalPaidTestProvider ===
      true
  );
}
