import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  clearIdempotencyKeysForTests,
  readGenerationRecord,
  updateGenerationRecord,
} from "@/video-generation/generation-store";
import {
  cancelVideoGeneration,
  refreshGenerationStatus,
  retryTransferGeneration,
  submitVideoGeneration,
} from "@/video-generation/service";
import {
  resetMockVideoProviderTasks,
} from "@/video-generation/provider/mock-provider";
import { updateGenerationBrowserMetadata } from "@/video-generation/update-browser-metadata";
import type {
  GenerationRecord,
  VideoGenerationInput,
} from "@/video-generation/types";

/** 仅用于结构/完整性单测：含 box 标记，不声称可被浏览器解码 */
function buildStructuralMp4Fixture(extraBytes = 512): Buffer {
  const header = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  ]);
  const mid = Buffer.from("moovtrakmdat", "ascii");
  const pad = Buffer.alloc(extraBytes, 0x7a);
  return Buffer.concat([header, mid, pad]);
}

function baseInput(overrides?: Partial<VideoGenerationInput>): VideoGenerationInput {
  return {
    shotId: `shot-e2e-${randomUUID()}`,
    projectId: "demo-e2e",
    prompt: "e2e mock flow",
    resolution: "720P",
    aspectRatio: "9:16",
    durationSeconds: 5,
    watermark: false,
    promptExtend: true,
    characterReferences: [],
    sceneReferences: [],
    imageReferences: [],
    referenceVideos: [],
    orderedReferenceMedia: [],
    textInputs: [],
    referenceSelectionMode: "auto",
    selectedReferenceAssetIds: [],
    ...overrides,
  };
}

async function pollUntilTerminal(
  generationId: string,
  maxTicks = 8,
): Promise<GenerationRecord> {
  let last = await refreshGenerationStatus(generationId, { force: true });
  for (let i = 0; i < maxTicks; i += 1) {
    if (
      last.status === "completed" ||
      last.status === "failed" ||
      last.status === "cancelled" ||
      last.status === "resultTransferFailed"
    ) {
      return last;
    }
    last = await refreshGenerationStatus(generationId, { force: true });
  }
  return last;
}

async function cleanupGenerationArtifacts(ids: string[], assetIds: string[]) {
  for (const id of ids) {
    const file = path.join(
      process.cwd(),
      "data",
      "generations",
      `${id}.json`,
    );
    await fs.unlink(file).catch(() => undefined);
  }
  const assetsDir = resolveAppDataPath("assets");
  const entries = await fs.readdir(assetsDir).catch(() => [] as string[]);
  for (const assetId of assetIds) {
    for (const name of entries) {
      if (name.startsWith(assetId)) {
        await fs.unlink(path.join(assetsDir, name)).catch(() => undefined);
      }
    }
  }
}

describe("阶段 3D-A Mock service 端到端", () => {
  const tmpDirs: string[] = [];
  const generationIds: string[] = [];
  const assetIds: string[] = [];
  const prevProvider = process.env.VIDEO_PROVIDER;
  const prevPaid = process.env.ALLOW_PAID_GENERATION;
  const prevMockFile = process.env.MOCK_VIDEO_FILE;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    await clearIdempotencyKeysForTests();
    resetMockVideoProviderTasks();
    process.env.VIDEO_PROVIDER = "mock";
    process.env.ALLOW_PAID_GENERATION = "false";
    fetchCalls = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      return originalFetch(...args);
    }) as typeof fetch;

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mock-e2e-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "src.mp4");
    await fs.writeFile(file, buildStructuralMp4Fixture(2048));
    process.env.MOCK_VIDEO_FILE = file;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (prevProvider === undefined) delete process.env.VIDEO_PROVIDER;
    else process.env.VIDEO_PROVIDER = prevProvider;
    if (prevPaid === undefined) delete process.env.ALLOW_PAID_GENERATION;
    else process.env.ALLOW_PAID_GENERATION = prevPaid;
    if (prevMockFile === undefined) delete process.env.MOCK_VIDEO_FILE;
    else process.env.MOCK_VIDEO_FILE = prevMockFile;

    await cleanupGenerationArtifacts(
      generationIds.splice(0),
      assetIds.splice(0),
    );
    resetMockVideoProviderTasks();
    await clearIdempotencyKeysForTests();
    for (const dir of tmpDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("完整 Mock 流程：queued → processing → downloading → completed 且有 generatedVideo", async () => {
    const record = await submitVideoGeneration({
      input: baseInput(),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: `e2e-flow-${randomUUID()}`,
    });
    generationIds.push(record.id);
    expect(record.status).toBe("queued");
    expect(record.isMock).toBe(true);
    expect(record.progress).toBeNull();
    expect(record.progressLabel).toMatch(/Mock/);

    const done = await pollUntilTerminal(record.id);
    expect(done.status).toBe("completed");
    expect(done.resultAsset).not.toBeNull();
    expect(done.resultAsset?.assetType).toBe("generatedVideo");
    expect(done.resultAsset?.mimeType).toBe("video/mp4");
    expect(done.localVideoAssetId).toBe(done.resultAsset?.id);
    expect(done.resultAsset?.sizeBytes).toBeGreaterThan(98);
    if (done.resultAsset) assetIds.push(done.resultAsset.id);
    expect(fetchCalls).toBe(0);
  });

  it("相同 idempotencyKey 与相同 fingerprint 不创建重复任务", async () => {
    const key = `idem-${randomUUID()}`;
    const input = baseInput();
    const a = await submitVideoGeneration({
      input,
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    generationIds.push(a.id);
    const b = await submitVideoGeneration({
      input,
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    expect(b.id).toBe(a.id);
    expect(b.requestSnapshot.prompt).toBe("e2e mock flow");
  });

  it("相同 idempotencyKey 不同 fingerprint 被拒绝", async () => {
    const key = `idem-fp-${randomUUID()}`;
    const a = await submitVideoGeneration({
      input: baseInput(),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    generationIds.push(a.id);
    await expect(
      submitVideoGeneration({
        input: baseInput({ prompt: "different prompt must not reuse key" }),
        unsupportedAudioLabels: [],
        confirmPaidGeneration: false,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    });
  });

  it("retry 使用最新工作流输入、新幂等键且不复用旧 providerTaskId", async () => {
    const shotId = `shot-retry-${randomUUID()}`;
    const first = await submitVideoGeneration({
      input: baseInput({ shotId, prompt: "old prompt", durationSeconds: 5 }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: `retry-old-${randomUUID()}`,
    });
    generationIds.push(first.id);
    const oldTaskId = first.providerTaskId;

    // 先完成或取消，否则同镜头 active 会阻止第二单
    await cancelVideoGeneration(first.id);

    const retry = await submitVideoGeneration({
      input: baseInput({
        shotId,
        prompt: "latest workflow prompt",
        durationSeconds: 8,
        resolution: "1080P",
        aspectRatio: "16:9",
        referenceSelectionMode: "manual",
        selectedReferenceAssetIds: [],
      }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: `retry-new-${randomUUID()}`,
    });
    generationIds.push(retry.id);

    expect(retry.id).not.toBe(first.id);
    expect(retry.providerTaskId).not.toBe(oldTaskId);
    expect(retry.requestSnapshot.prompt).toBe("latest workflow prompt");
    expect(retry.requestedDurationSeconds).toBe(8);
    expect(retry.requestedResolution).toBe("1080P");
    expect(retry.requestedAspectRatio).toBe("16:9");
    // 旧任务记录保留
    const oldStill = await readGenerationRecord(first.id);
    expect(oldStill?.id).toBe(first.id);
    expect(oldStill?.requestSnapshot.prompt).toBe("old prompt");
  });

  it("仅 queued/validating 可取消；processing 后不能伪装取消成功", async () => {
    const shotId = `shot-cancel-${randomUUID()}`;
    const queued = await submitVideoGeneration({
      input: baseInput({ shotId }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
    });
    generationIds.push(queued.id);
    expect(queued.status).toBe("queued");
    const cancelled = await cancelVideoGeneration(queued.id);
    expect(cancelled.status).toBe("cancelled");

    const again = await submitVideoGeneration({
      input: baseInput({ shotId, prompt: "cancel-processing" }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
    });
    generationIds.push(again.id);
    // tick 进入 processing
    const processing = await refreshGenerationStatus(again.id, { force: true });
    expect(processing.status).toBe("processing");
    await expect(cancelVideoGeneration(again.id)).rejects.toMatchObject({
      code: "CANCEL_NOT_ALLOWED",
    });

    const after = await readGenerationRecord(again.id);
    expect(after?.status).toBe("processing");
  });

  it("cancelled 不会继续被轮询为 completed", async () => {
    const queued = await submitVideoGeneration({
      input: baseInput({ prompt: "stay cancelled" }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
    });
    generationIds.push(queued.id);
    await cancelVideoGeneration(queued.id);
    const polled = await refreshGenerationStatus(queued.id, { force: true });
    expect(polled.status).toBe("cancelled");
    expect(polled.resultAsset).toBeNull();
  });

  it("transfer 幂等：已 completed 不再复制新资产", async () => {
    const record = await submitVideoGeneration({
      input: baseInput({ prompt: "transfer idem" }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
    });
    generationIds.push(record.id);
    const done = await pollUntilTerminal(record.id);
    expect(done.status).toBe("completed");
    if (done.resultAsset) assetIds.push(done.resultAsset.id);
    const firstAssetId = done.resultAsset!.id;

    const again = await retryTransferGeneration(done.id);
    expect(again.idempotent).toBe(true);
    expect(again.generation.resultAsset?.id).toBe(firstAssetId);
    expect(again.asset?.id).toBe(firstAssetId);
  });

  it("metadata 幂等且不修改 requested/provider/status", async () => {
    const record = await submitVideoGeneration({
      input: baseInput({ prompt: "meta idem" }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
    });
    generationIds.push(record.id);
    const done = await pollUntilTerminal(record.id);
    if (done.resultAsset) assetIds.push(done.resultAsset.id);

    const first = await updateGenerationBrowserMetadata({
      generationId: done.id,
      videoAssetId: done.resultAsset!.id,
      actualWidth: 720,
      actualHeight: 1280,
      actualDurationSeconds: 5.02,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.idempotent).toBe(false);

    const second = await updateGenerationBrowserMetadata({
      generationId: done.id,
      videoAssetId: done.resultAsset!.id,
      actualWidth: 720,
      actualHeight: 1280,
      actualDurationSeconds: 5.02,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.idempotent).toBe(true);
    expect(second.generation.requestedResolution).toBe("720P");
    expect(second.generation.requestedAspectRatio).toBe("9:16");
    expect(second.generation.status).toBe("completed");
    expect(second.generation.providerTaskId).toBe(done.providerTaskId);
    expect(second.generation.metadataSource).toBe("browser");
  });

  it("requestSnapshot 不含 base64、磁盘路径与密钥", async () => {
    const record = await submitVideoGeneration({
      input: baseInput({
        prompt: "safe snapshot",
        orderedReferenceMedia: [],
      }),
      unsupportedAudioLabels: ["旁白.mp3"],
      confirmPaidGeneration: false,
    });
    generationIds.push(record.id);
    const snap = JSON.stringify(record.requestSnapshot);
    expect(snap).not.toMatch(/base64/i);
    expect(snap).not.toMatch(/data:[^;]+;base64,/i);
    expect(snap).not.toMatch(/[A-Za-z]:\\/);
    expect(snap).not.toMatch(/\/Users\//);
    expect(snap).not.toMatch(/DASHSCOPE|sk-/i);
    expect(record.requestSnapshot.prompt).toBe("safe snapshot");
    expect(record.requestSnapshot.mediaAssetIds).toEqual([]);
    expect(record.requestSnapshot.unsupportedAudioLabels).toEqual(["旁白.mp3"]);
    expect(record.requestSnapshot.settings.resolution).toBe("720P");
    expect(record.requestSnapshot.settings.aspectRatio).toBe("9:16");
    expect(record.requestSnapshot.settings.durationSeconds).toBe(5);
  });

  it("Mock 源缺失时 failed：MOCK_VIDEO_NOT_CONFIGURED，不伪装 completed", async () => {
    const missDir = await fs.mkdtemp(path.join(os.tmpdir(), "mock-miss-e2e-"));
    tmpDirs.push(missDir);
    process.env.MOCK_VIDEO_FILE = path.join(missDir, "missing.mp4");

    try {
      await submitVideoGeneration({
        input: baseInput({ prompt: "missing mock" }),
        unsupportedAudioLabels: [],
        confirmPaidGeneration: false,
      });
      expect.unreachable("should throw");
    } catch (err) {
      const e = err as Error & { code?: string; generation?: GenerationRecord };
      expect(e.code).toBe("MOCK_VIDEO_NOT_CONFIGURED");
      if (e.generation) {
        generationIds.push(e.generation.id);
        expect(e.generation.status).toBe("failed");
        expect(e.generation.resultAsset).toBeNull();
      }
    }
  });

  it("无效 Mock MP4 不会 completed", async () => {
    const badDir = await fs.mkdtemp(path.join(os.tmpdir(), "mock-bad-e2e-"));
    tmpDirs.push(badDir);
    const bad = path.join(badDir, "bad.mp4");
    // 98B 伪占位
    const placeholder = Buffer.from(
      "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAt1tb292AAAAbG12aGQAAAAA1tQtodbdLaEAAAW+AAAD6F9waWEAAAAgbWRhdAAAAAAAAm1kYXQ=",
      "base64",
    );
    await fs.writeFile(bad, placeholder);
    process.env.MOCK_VIDEO_FILE = bad;

    try {
      await submitVideoGeneration({
        input: baseInput({ prompt: "invalid mock" }),
        unsupportedAudioLabels: [],
        confirmPaidGeneration: false,
      });
      expect.unreachable("should throw");
    } catch (err) {
      const e = err as Error & { code?: string; generation?: GenerationRecord };
      expect(e.code).toBe("MOCK_VIDEO_INVALID");
      if (e.generation) {
        generationIds.push(e.generation.id);
        expect(e.generation.status).toBe("failed");
        expect(e.generation.resultAsset).toBeNull();
      }
    }
  });

  it("completed 轮询不会再次转存覆盖", async () => {
    const record = await submitVideoGeneration({
      input: baseInput({ prompt: "no retransfer" }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
    });
    generationIds.push(record.id);
    const done = await pollUntilTerminal(record.id);
    if (done.resultAsset) assetIds.push(done.resultAsset.id);
    const assetId = done.resultAsset!.id;
    const again = await refreshGenerationStatus(done.id, { force: true });
    expect(again.status).toBe("completed");
    expect(again.resultAsset?.id).toBe(assetId);
  });

  it("resultTransferFailed 不显示为 completed；可幂等恢复已有资产", async () => {
    const record = await submitVideoGeneration({
      input: baseInput({ prompt: "xfer fail state" }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
    });
    generationIds.push(record.id);
    const done = await pollUntilTerminal(record.id);
    if (done.resultAsset) assetIds.push(done.resultAsset.id);

    // 人为写成转存失败但资产仍在 → 重试应幂等收口 completed
    await updateGenerationRecord(done.id, {
      status: "resultTransferFailed",
      errorCode: "RESULT_TRANSFER_FAILED",
      errorMessage: "simulated",
      progressLabel: "结果转存失败",
    });
    const mid = await readGenerationRecord(done.id);
    expect(mid?.status).toBe("resultTransferFailed");
    expect(mid?.status).not.toBe("completed");

    const recovered = await retryTransferGeneration(done.id);
    expect(recovered.idempotent).toBe(true);
    expect(recovered.generation.status).toBe("completed");
    expect(recovered.generation.resultAsset?.id).toBe(done.resultAsset?.id);
  });

  it("不发生真实外部 HTTP 请求（Mock 全链路）", async () => {
    const record = await submitVideoGeneration({
      input: baseInput({ prompt: "no http" }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
    });
    generationIds.push(record.id);
    const done = await pollUntilTerminal(record.id);
    if (done.resultAsset) assetIds.push(done.resultAsset.id);
    expect(done.status).toBe("completed");
    expect(fetchCalls).toBe(0);
  });

  it("VIDEO_PROVIDER 默认 mock 且 ALLOW_PAID_GENERATION 默认 false", async () => {
    delete process.env.VIDEO_PROVIDER;
    delete process.env.ALLOW_PAID_GENERATION;
    const { getVideoProviderRuntimeConfig } = await import(
      "@/video-generation/provider/config"
    );
    const config = getVideoProviderRuntimeConfig({});
    expect(config.providerId).toBe("mock");
    expect(config.allowPaidGeneration).toBe(false);
  });
});
