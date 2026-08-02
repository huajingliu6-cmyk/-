import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  getMockCapabilities,
  pickCapability,
} from "../model-capabilities";
import {
  hashFileSha256,
  validateMockVideoSource,
} from "../validate-mock-video-source";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import type {
  ProviderCancelResult,
  ProviderGenerationInput,
  ProviderStatusResult,
  ProviderSubmitResult,
} from "../types";
import type { VideoProvider } from "./types";
import { ProviderOutcomeUnknownError } from "../idempotency/errors";

type MockTask = {
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  tick: number;
  videoPath: string | null;
  remoteUrl: string | null;
  resolution: string;
  aspectRatio: string | null;
  durationSeconds: number;
  errorCode?: string;
  errorMessage?: string;
};

type MockTasksGlobal = typeof globalThis & {
  __infiniteCanvasMockTasks?: Map<string, MockTask>;
  __infiniteCanvasMockSubmitHook?: (() => void | Promise<void>) | null;
  __infiniteCanvasMockSubmitCount?: number;
};

/**
 * 必须挂在 globalThis：Next webpack 开发态会对路由分别打包/HMR，
 * 模块级 Map 会在 POST 提交与 GET 轮询之间变成两份。
 */
function getTasks(): Map<string, MockTask> {
  const g = globalThis as MockTasksGlobal;
  if (!g.__infiniteCanvasMockTasks) {
    g.__infiniteCanvasMockTasks = new Map();
  }
  return g.__infiniteCanvasMockTasks;
}

/**
 * 从已验证的本地 Mock 源复制出独立任务文件（不共享可被覆盖的同一路径）。
 * 不再手写 98 B 伪 MP4。
 */
async function materializeMockVideoCopy(): Promise<{
  absolutePath: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}> {
  if (isRemoteDataOnly()) {
    throw Object.assign(
      new Error("Remote mock generation must be provided by an internal service"),
      { code: "REMOTE_MOCK_PROVIDER_REQUIRES_INTERNAL_SERVICE" },
    );
  }

  const validated = await validateMockVideoSource();
  if (!validated.ok) {
    throw Object.assign(new Error(validated.message), {
      code: validated.code,
    });
  }

  const dir = resolveAppDataPath("generated-videos");
  await fs.mkdir(dir, { recursive: true });
  const id = randomUUID();
  const fileName = `${id}-mock.mp4`;
  const absolutePath = path.join(dir, fileName);
  const tmp = `${absolutePath}.tmp`;

  await fs.copyFile(validated.absolutePath, tmp);
  const statTmp = await fs.stat(tmp);
  if (statTmp.size !== validated.sizeBytes) {
    await fs.unlink(tmp).catch(() => undefined);
    throw Object.assign(new Error("复制 Mock 视频后大小不一致"), {
      code: "MOCK_VIDEO_INVALID",
    });
  }
  const shaTmp = await hashFileSha256(tmp);
  if (shaTmp !== validated.sha256) {
    await fs.unlink(tmp).catch(() => undefined);
    throw Object.assign(new Error("复制 Mock 视频后哈希不一致"), {
      code: "MOCK_VIDEO_INVALID",
    });
  }
  await fs.rename(tmp, absolutePath);
  const statFinal = await fs.stat(absolutePath);
  const shaFinal = await hashFileSha256(absolutePath);
  if (
    statFinal.size !== validated.sizeBytes ||
    shaFinal !== validated.sha256
  ) {
    await fs.unlink(absolutePath).catch(() => undefined);
    throw Object.assign(new Error("Mock 视频落盘完整性校验失败"), {
      code: "MOCK_VIDEO_INVALID",
    });
  }

  return {
    absolutePath,
    url: `/api/generated-videos/${fileName}`,
    sizeBytes: statFinal.size,
    sha256: shaFinal,
  };
}

function ensureTask(
  providerTaskId: string,
  seed?: Partial<MockTask>,
): MockTask {
  const tasks = getTasks();
  const existing = tasks.get(providerTaskId);
  if (existing) return existing;
  const created: MockTask = {
    status: "queued",
    tick: 0,
    videoPath: null,
    remoteUrl: null,
    resolution: seed?.resolution ?? "720P",
    aspectRatio: seed?.aspectRatio ?? "9:16",
    durationSeconds: seed?.durationSeconds ?? 5,
  };
  tasks.set(providerTaskId, created);
  return created;
}

export class MockVideoProvider implements VideoProvider {
  readonly id = "mock" as const;

  getCapabilities() {
    return getMockCapabilities();
  }

  async submitGeneration(
    input: ProviderGenerationInput,
  ): Promise<ProviderSubmitResult> {
    const g = globalThis as MockTasksGlobal;
    g.__infiniteCanvasMockSubmitCount =
      (g.__infiniteCanvasMockSubmitCount ?? 0) + 1;

    // 测试可注入：在“请求已发出”语义下抛出未知结果（不访问真实网络）
    if (g.__infiniteCanvasMockSubmitHook) {
      await g.__infiniteCanvasMockSubmitHook();
    }

    if (isRemoteDataOnly()) {
      throw Object.assign(
        new Error("Remote mock generation must be provided by an internal service"),
        { code: "REMOTE_MOCK_PROVIDER_REQUIRES_INTERNAL_SERVICE" },
      );
    }

    // 提交前即校验：缺失/无效时不排队伪装成功
    const validated = await validateMockVideoSource();
    if (!validated.ok) {
      throw Object.assign(new Error(validated.message), {
        code: validated.code,
      });
    }

    const taskId = `mock-${randomUUID()}`;
    ensureTask(taskId, {
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
    if (!getTasks().has(providerTaskId) && !providerTaskId.startsWith("mock-")) {
      return {
        providerTaskId,
        status: "failed",
        progressLabel: "Mock · 任务不存在",
        errorCode: "MOCK_TASK_NOT_FOUND",
        errorMessage: "Mock Provider 不能查询非 Mock 任务",
        rawTaskStatus: "FAILED",
      };
    }
    const task = ensureTask(providerTaskId);

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
        errorCode: task.errorCode ?? "MOCK_FAILED",
        errorMessage: task.errorMessage ?? "Mock 任务失败",
        rawTaskStatus: "FAILED",
      };
    }

    if (task.status === "completed" && task.remoteUrl) {
      return {
        providerTaskId,
        status: "downloading",
        progressLabel: "Mock · 准备转存",
        remoteVideoUrl: task.remoteUrl,
        providerResolution:
          task.resolution === "1080P"
            ? "1080"
            : task.resolution === "480P"
              ? "480"
              : "720",
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

    try {
      const written = await materializeMockVideoCopy();
      task.status = "completed";
      task.videoPath = written.absolutePath;
      // 仅服务端转存使用 file://；不把本机绝对路径发给浏览器
      task.remoteUrl = `file://${written.absolutePath.replace(/\\/g, "/")}`;

      return {
        providerTaskId,
        status: "downloading",
        progressLabel: "Mock · 准备转存",
        remoteVideoUrl: task.remoteUrl,
        providerResolution:
          task.resolution === "1080P"
            ? "1080"
            : task.resolution === "480P"
              ? "480"
              : "720",
        providerAspectRatio: task.aspectRatio ?? undefined,
        providerDurationSeconds: task.durationSeconds,
        rawTaskStatus: "SUCCEEDED",
      };
    } catch (error) {
      const code =
        error instanceof Error &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : "MOCK_VIDEO_INVALID";
      const message =
        error instanceof Error
          ? error.message
          : "Mock 视频源无效";
      task.status = "failed";
      task.errorCode = code;
      task.errorMessage = message;
      return {
        providerTaskId,
        status: "failed",
        progressLabel: "Mock · 失败",
        errorCode: code,
        errorMessage: message,
        rawTaskStatus: "FAILED",
      };
    }
  }

  async cancelGeneration(
    providerTaskId: string,
  ): Promise<ProviderCancelResult> {
    const tasks = getTasks();
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
  getTasks().clear();
  const g = globalThis as MockTasksGlobal;
  g.__infiniteCanvasMockSubmitHook = null;
  g.__infiniteCanvasMockSubmitCount = 0;
}

/** 测试：注入 submit 钩子（可抛 ProviderOutcomeUnknownError） */
export function setMockProviderSubmitHookForTests(
  hook: (() => void | Promise<void>) | null,
): void {
  (globalThis as MockTasksGlobal).__infiniteCanvasMockSubmitHook = hook;
}

export function getMockProviderSubmitCountForTests(): number {
  return (globalThis as MockTasksGlobal).__infiniteCanvasMockSubmitCount ?? 0;
}

export function resetMockProviderSubmitCountForTests(): void {
  (globalThis as MockTasksGlobal).__infiniteCanvasMockSubmitCount = 0;
}

/** 便捷：注入未知结果（模拟请求已发送但无法确认接单） */
export function injectMockProviderUnknownOutcomeForTests(): void {
  setMockProviderSubmitHookForTests(() => {
    throw new ProviderOutcomeUnknownError();
  });
}

export function getMockCapabilityForMode(
  mode: "textToVideo" | "referenceToVideo",
) {
  return pickCapability(getMockCapabilities(), mode);
}
