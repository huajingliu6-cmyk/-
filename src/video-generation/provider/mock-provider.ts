import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  getMockCapabilities,
  pickCapability,
} from "../model-capabilities";
import type {
  ProviderCancelResult,
  ProviderGenerationInput,
  ProviderStatusResult,
  ProviderSubmitResult,
} from "../types";
import type { VideoProvider } from "./types";

type MockTask = {
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  tick: number;
  videoPath: string | null;
  remoteUrl: string | null;
  resolution: string;
  aspectRatio: string | null;
  durationSeconds: number;
};

const tasks = new Map<string, MockTask>();

/**
 * 极小合法 MP4（ftyp+mdat），仅用于 Mock，明确标记非真实 AI 视频。
 */
const MINIMAL_MP4 = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAt1tb292AAAAbG12aGQAAAAA1tQtodbdLaEAAAW+AAAD6F9waWEAAAAgbWRhdAAAAAAAAm1kYXQ=",
  "base64",
);

async function writeMockMp4(): Promise<{ absolutePath: string; url: string }> {
  const dir = path.join(process.cwd(), "data", "generated-videos");
  await fs.mkdir(dir, { recursive: true });
  const id = randomUUID();
  const fileName = `${id}-mock.mp4`;
  const absolutePath = path.join(dir, fileName);
  const tmp = `${absolutePath}.tmp`;
  await fs.writeFile(tmp, MINIMAL_MP4);
  await fs.rename(tmp, absolutePath);
  return {
    absolutePath,
    url: `/api/generated-videos/${fileName}`,
  };
}

export class MockVideoProvider implements VideoProvider {
  readonly id = "mock" as const;

  getCapabilities() {
    return getMockCapabilities();
  }

  async submitGeneration(
    input: ProviderGenerationInput,
  ): Promise<ProviderSubmitResult> {
    const taskId = `mock-${randomUUID()}`;
    tasks.set(taskId, {
      status: "queued",
      tick: 0,
      videoPath: null,
      remoteUrl: null,
      resolution: input.input.resolution,
      aspectRatio: input.input.aspectRatio,
      durationSeconds: input.input.durationSeconds,
    });
    return {
      providerTaskId: taskId,
      status: "queued",
      progressLabel: "Mock · 排队中",
    };
  }

  async getGenerationStatus(
    providerTaskId: string,
  ): Promise<ProviderStatusResult> {
    const task = tasks.get(providerTaskId);
    if (!task) {
      return {
        providerTaskId,
        status: "failed",
        progressLabel: "Mock · 任务不存在",
        errorCode: "MOCK_TASK_NOT_FOUND",
        errorMessage: "Mock 任务不存在或已过期",
        rawTaskStatus: "UNKNOWN",
      };
    }

    if (task.status === "cancelled") {
      return {
        providerTaskId,
        status: "cancelled",
        progressLabel: "Mock · 已取消",
        rawTaskStatus: "CANCELED",
      };
    }

    if (task.status === "failed") {
      return {
        providerTaskId,
        status: "failed",
        progressLabel: "Mock · 失败",
        errorCode: "MOCK_FAILED",
        errorMessage: "Mock 任务失败",
        rawTaskStatus: "FAILED",
      };
    }

    if (task.status === "completed" && task.remoteUrl) {
      return {
        providerTaskId,
        status: "downloading",
        progressLabel: "Mock · 准备转存",
        remoteVideoUrl: task.remoteUrl,
        providerResolution: task.resolution === "1080P" ? "1080" : "720",
        providerAspectRatio: task.aspectRatio ?? undefined,
        providerDurationSeconds: task.durationSeconds,
        rawTaskStatus: "SUCCEEDED",
      };
    }

    task.tick += 1;
    if (task.tick === 1) {
      task.status = "processing";
      return {
        providerTaskId,
        status: "processing",
        progressLabel: "Mock · 正在生成",
        rawTaskStatus: "RUNNING",
      };
    }

    const written = await writeMockMp4();
    task.status = "completed";
    task.videoPath = written.absolutePath;
    // 使用本地可下载路径模拟「临时 URL」；服务端转存会再拷贝一次
    task.remoteUrl = `file://${written.absolutePath.replace(/\\/g, "/")}`;

    return {
      providerTaskId,
      status: "downloading",
      progressLabel: "Mock · 准备转存",
      remoteVideoUrl: task.remoteUrl,
      providerResolution: task.resolution === "1080P" ? "1080" : "720",
      providerAspectRatio: task.aspectRatio ?? undefined,
      providerDurationSeconds: task.durationSeconds,
      rawTaskStatus: "SUCCEEDED",
    };
  }

  async cancelGeneration(
    providerTaskId: string,
  ): Promise<ProviderCancelResult> {
    const task = tasks.get(providerTaskId);
    if (!task) {
      return { cancelled: false, message: "Mock 任务不存在" };
    }
    if (task.status !== "queued") {
      return {
        cancelled: false,
        message: "仅排队中（PENDING）的任务可以取消",
      };
    }
    task.status = "cancelled";
    return { cancelled: true, message: "Mock 任务已取消" };
  }
}

/** 测试辅助：清空内存任务 */
export function resetMockVideoProviderTasks(): void {
  tasks.clear();
}

export function getMockCapabilityForMode(
  mode: "textToVideo" | "referenceToVideo",
) {
  return pickCapability(getMockCapabilities(), mode);
}
