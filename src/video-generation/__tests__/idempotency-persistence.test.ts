import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  clearIdempotencyKeysForTests,
  readGenerationRecord,
  updateGenerationRecord,
} from "@/video-generation/generation-store";
import {
  buildGenerationRequestFingerprint,
  FileGenerationIdempotencyStore,
  getIdempotencyStore,
  IDEMPOTENCY_SCOPE,
  parseIdempotencyRecord,
  reconcileGenerationIdempotencyRecord,
  setIdempotencyStoreForTests,
  stableStringify,
} from "@/video-generation/idempotency";
import {
  retryTransferGeneration,
  retryVideoGeneration,
  submitVideoGeneration,
} from "@/video-generation/service";
import {
  getMockProviderSubmitCountForTests,
  injectMockProviderUnknownOutcomeForTests,
  resetMockProviderSubmitCountForTests,
  resetMockVideoProviderTasks,
  setMockProviderSubmitHookForTests,
} from "@/video-generation/provider/mock-provider";
import type { VideoGenerationInput } from "@/video-generation/types";

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
    shotId: `shot-idem-${randomUUID()}`,
    projectId: "demo-idem",
    prompt: "idempotency test prompt",
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

describe("阶段 3D-B1-A 持久化幂等", () => {
  const tmpDirs: string[] = [];
  const generationIds: string[] = [];
  const prevProvider = process.env.VIDEO_PROVIDER;
  const prevPaid = process.env.ALLOW_PAID_GENERATION;
  const prevMockFile = process.env.MOCK_VIDEO_FILE;
  let storeDir = "";
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "idem-store-"));
    tmpDirs.push(storeDir);
    setIdempotencyStoreForTests(new FileGenerationIdempotencyStore(storeDir));
    await clearIdempotencyKeysForTests();
    resetMockVideoProviderTasks();
    resetMockProviderSubmitCountForTests();
    process.env.VIDEO_PROVIDER = "mock";
    process.env.ALLOW_PAID_GENERATION = "false";
    fetchCalls = 0;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      return originalFetch(...args);
    }) as typeof fetch;

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idem-mock-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "src.mp4");
    await fs.writeFile(file, buildStructuralMp4Fixture(2048));
    process.env.MOCK_VIDEO_FILE = file;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    setMockProviderSubmitHookForTests(null);
    if (prevProvider === undefined) delete process.env.VIDEO_PROVIDER;
    else process.env.VIDEO_PROVIDER = prevProvider;
    if (prevPaid === undefined) delete process.env.ALLOW_PAID_GENERATION;
    else process.env.ALLOW_PAID_GENERATION = prevPaid;
    if (prevMockFile === undefined) delete process.env.MOCK_VIDEO_FILE;
    else process.env.MOCK_VIDEO_FILE = prevMockFile;

    for (const id of generationIds.splice(0)) {
      await fs
        .unlink(path.join(process.cwd(), "data", "generations", `${id}.json`))
        .catch(() => undefined);
    }
    resetMockVideoProviderTasks();
    await clearIdempotencyKeysForTests();
    setIdempotencyStoreForTests(null);
    for (const dir of tmpDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("1. 同 key 同 fingerprint 返回同 generation", async () => {
    const key = `k-${randomUUID()}`;
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
    expect(getMockProviderSubmitCountForTests()).toBe(1);
  });

  it("2. 同 key 不同 fingerprint 被拒绝", async () => {
    const key = `k-${randomUUID()}`;
    const a = await submitVideoGeneration({
      input: baseInput(),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    generationIds.push(a.id);
    await expect(
      submitVideoGeneration({
        input: baseInput({ prompt: "other" }),
        unsupportedAudioLabels: [],
        confirmPaidGeneration: false,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    });
  });

  it("3+4. reserve 在 Provider 前完成且 Provider 只调用一次", async () => {
    const key = `k-${randomUUID()}`;
    const input = baseInput();
    const order: string[] = [];
    setMockProviderSubmitHookForTests(() => {
      order.push("provider");
    });
    const store = getIdempotencyStore();
    const origReserve = store.reserve.bind(store);
    store.reserve = async (inputArgs) => {
      order.push("reserve");
      return origReserve(inputArgs);
    };
    const a = await submitVideoGeneration({
      input,
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    generationIds.push(a.id);
    expect(order.indexOf("reserve")).toBeLessThan(order.indexOf("provider"));
    await submitVideoGeneration({
      input,
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    expect(getMockProviderSubmitCountForTests()).toBe(1);
  });

  it("5. 进程内对象重建后仍可从文件恢复", async () => {
    const key = `k-${randomUUID()}`;
    const input = baseInput();
    const a = await submitVideoGeneration({
      input,
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    generationIds.push(a.id);
    // 重建 store 实例（模拟进程重启后重新挂载同一目录）
    setIdempotencyStoreForTests(new FileGenerationIdempotencyStore(storeDir));
    const b = await submitVideoGeneration({
      input,
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    expect(b.id).toBe(a.id);
    expect(getMockProviderSubmitCountForTests()).toBe(1);
  });

  it("6. providerTaskId 先写幂等记录", async () => {
    const key = `k-${randomUUID()}`;
    let seenTaskInIdemBeforeGenUpdate = false;
    setMockProviderSubmitHookForTests(async () => {
      // hook 在 mock 创建 task 之前；改为在 markProviderAccepted 后验证
    });
    const store = getIdempotencyStore() as FileGenerationIdempotencyStore;
    const origAccepted = store.markProviderAccepted.bind(store);
    store.markProviderAccepted = async (scope, k, gid, taskId) => {
      const before = await readGenerationRecord(gid);
      expect(before?.providerTaskId ?? "").toBe("");
      const next = await origAccepted(scope, k, gid, taskId);
      seenTaskInIdemBeforeGenUpdate = next.providerTaskId === taskId;
      return next;
    };
    const a = await submitVideoGeneration({
      input: baseInput(),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    generationIds.push(a.id);
    expect(seenTaskInIdemBeforeGenUpdate).toBe(true);
    expect(a.providerTaskId).toMatch(/^mock-/);
  });

  it("7. GenerationRecord 更新失败后可从记录恢复 taskId", async () => {
    const key = `k-${randomUUID()}`;
    const a = await submitVideoGeneration({
      input: baseInput(),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    generationIds.push(a.id);
    const taskId = a.providerTaskId;
    await updateGenerationRecord(a.id, { providerTaskId: "" });
    const store = getIdempotencyStore();
    // 模拟仍停在 providerAccepted
    await store.markProviderAccepted(
      IDEMPOTENCY_SCOPE,
      key,
      a.id,
      taskId,
    );
    const reconciled = await reconcileGenerationIdempotencyRecord({
      scope: IDEMPOTENCY_SCOPE,
      idempotencyKey: key,
    });
    expect(reconciled.generation?.providerTaskId).toBe(taskId);
    expect(reconciled.mutated).toBe(true);
  });

  it("8+9. unknown outcome 不自动重试且同 key 再提交被阻止", async () => {
    const key = `k-${randomUUID()}`;
    const input = baseInput();
    injectMockProviderUnknownOutcomeForTests();
    await expect(
      submitVideoGeneration({
        input,
        unsupportedAudioLabels: [],
        confirmPaidGeneration: false,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: "GENERATION_SUBMISSION_UNKNOWN" });
    expect(getMockProviderSubmitCountForTests()).toBe(1);

    setMockProviderSubmitHookForTests(null);
    resetMockProviderSubmitCountForTests();
    await expect(
      submitVideoGeneration({
        input,
        unsupportedAudioLabels: [],
        confirmPaidGeneration: false,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: "GENERATION_SUBMISSION_UNKNOWN" });
    expect(getMockProviderSubmitCountForTests()).toBe(0);
  });

  it("10. safe failure 可按规则重试", async () => {
    const key = `k-${randomUUID()}`;
    const input = baseInput({ prompt: "safe-fail-then-ok" });
    const missDir = await fs.mkdtemp(path.join(os.tmpdir(), "idem-miss-"));
    tmpDirs.push(missDir);
    process.env.MOCK_VIDEO_FILE = path.join(missDir, "missing.mp4");

    await expect(
      submitVideoGeneration({
        input,
        unsupportedAudioLabels: [],
        confirmPaidGeneration: false,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: "MOCK_VIDEO_NOT_CONFIGURED" });

    const good = await fs.mkdtemp(path.join(os.tmpdir(), "idem-good-"));
    tmpDirs.push(good);
    const file = path.join(good, "src.mp4");
    await fs.writeFile(file, buildStructuralMp4Fixture(2048));
    process.env.MOCK_VIDEO_FILE = file;

    const ok = await submitVideoGeneration({
      input,
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    generationIds.push(ok.id);
    expect(ok.status).toBe("queued");
    expect(ok.providerTaskId).toMatch(/^mock-/);
  });

  it("11. committed 返回已有任务", async () => {
    const key = `k-${randomUUID()}`;
    const input = baseInput();
    const a = await submitVideoGeneration({
      input,
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    generationIds.push(a.id);
    const store = getIdempotencyStore();
    const rec = await store.get(IDEMPOTENCY_SCOPE, key);
    expect(rec?.state).toBe("committed");
    const b = await submitVideoGeneration({
      input,
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    expect(b.id).toBe(a.id);
  });

  it("12. submitting 返回 in progress", async () => {
    const key = `k-${randomUUID()}`;
    const input = baseInput();
    const store = getIdempotencyStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    setMockProviderSubmitHookForTests(async () => {
      await gate;
    });
    const pending = submitVideoGeneration({
      input,
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    // 等待进入 submitting
    for (let i = 0; i < 40; i += 1) {
      const rec = await store.get(IDEMPOTENCY_SCOPE, key);
      if (rec?.state === "submitting") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const mid = await store.get(IDEMPOTENCY_SCOPE, key);
    expect(mid?.state).toBe("submitting");
    const inProgress = await submitVideoGeneration({
      input,
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    generationIds.push(inProgress.id);
    expect(inProgress.id).toBe(mid?.generationId);
    release();
    const done = await pending;
    generationIds.push(done.id);
    expect(done.id).toBe(inProgress.id);
  });

  it("13. 文件损坏返回结构化错误", async () => {
    const store = new FileGenerationIdempotencyStore(storeDir);
    const key = `corrupt-${randomUUID()}`;
    const name = store.fileNameFor(IDEMPOTENCY_SCOPE, key);
    await fs.writeFile(path.join(storeDir, name), "{not-json", "utf8");
    await expect(store.get(IDEMPOTENCY_SCOPE, key)).rejects.toMatchObject({
      code: "IDEMPOTENCY_RECORD_CORRUPTED",
    });
  });

  it("14. 路径穿越被拒绝（key 不进路径）", async () => {
    const store = new FileGenerationIdempotencyStore(storeDir);
    const evil = "../../etc/passwd";
    const name = store.fileNameFor(IDEMPOTENCY_SCOPE, evil);
    expect(name).toMatch(/^[a-f0-9]{64}\.json$/);
    expect(name.includes("..")).toBe(false);
    await store.reserve({
      scope: IDEMPOTENCY_SCOPE,
      idempotencyKey: evil,
      requestFingerprint: "fp",
      generationId: randomUUID(),
      projectId: "p",
      shotNodeId: "s",
      providerId: "mock",
    });
    const entries = await fs.readdir(storeDir);
    expect(entries.every((e) => !e.includes(".."))).toBe(true);
    expect(path.resolve(storeDir, name).startsWith(path.resolve(storeDir))).toBe(
      true,
    );
  });

  it("15. 原子创建冲突只有一个 reserve 成功", async () => {
    const store = new FileGenerationIdempotencyStore(storeDir);
    const key = `race-${randomUUID()}`;
    const fp = "same-fp";
    const results = await Promise.all([
      store.reserve({
        scope: IDEMPOTENCY_SCOPE,
        idempotencyKey: key,
        requestFingerprint: fp,
        generationId: randomUUID(),
        projectId: "p",
        shotNodeId: "s",
        providerId: "mock",
      }),
      store.reserve({
        scope: IDEMPOTENCY_SCOPE,
        idempotencyKey: key,
        requestFingerprint: fp,
        generationId: randomUUID(),
        projectId: "p",
        shotNodeId: "s",
        providerId: "mock",
      }),
    ]);
    const reserved = results.filter((r) => r.kind === "reserved");
    const other = results.filter((r) => r.kind !== "reserved");
    expect(reserved.length).toBe(1);
    expect(other.length).toBe(1);
    expect(other[0]?.record.generationId).toBe(reserved[0]?.record.generationId);
  });

  it("16. 同 shot 不同 key 并发被阻止", async () => {
    const shotId = `shot-parallel-${randomUUID()}`;
    const a = await submitVideoGeneration({
      input: baseInput({ shotId }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: `k-a-${randomUUID()}`,
    });
    generationIds.push(a.id);
    await expect(
      submitVideoGeneration({
        input: baseInput({ shotId, prompt: "second tab" }),
        unsupportedAudioLabels: [],
        confirmPaidGeneration: false,
        idempotencyKey: `k-b-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: "ACTIVE_GENERATION_ALREADY_EXISTS" });
  });

  it("17. retryGeneration 使用新 key", async () => {
    const shotId = `shot-rg-${randomUUID()}`;
    const first = await submitVideoGeneration({
      input: baseInput({ shotId }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: `old-${randomUUID()}`,
    });
    generationIds.push(first.id);
    await updateGenerationRecord(first.id, {
      status: "failed",
      errorCode: "X",
      errorMessage: "done",
    });
    const newKey = `new-${randomUUID()}`;
    const retry = await retryVideoGeneration({
      previousGenerationId: first.id,
      input: baseInput({ shotId, prompt: "retry gen" }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: newKey,
    });
    generationIds.push(retry.id);
    expect(retry.id).not.toBe(first.id);
    expect(retry.idempotencyKey).toBe(newKey);
  });

  it("18. retryTransfer 不调用 Provider", async () => {
    const record = await submitVideoGeneration({
      input: baseInput(),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: `xfer-${randomUUID()}`,
    });
    generationIds.push(record.id);
    // 人工补全为已有结果资产形态，避免依赖完整轮询
    const { updateGenerationRecord: upd } = await import(
      "@/video-generation/generation-store"
    );
    // 走真实轮询转存更稳妥
    resetMockProviderSubmitCountForTests();
    const countBefore = getMockProviderSubmitCountForTests();
    // 无 remote 时 transfer 应失败且不 submit
    await expect(retryTransferGeneration(record.id)).rejects.toBeTruthy();
    expect(getMockProviderSubmitCountForTests()).toBe(countBefore);
    void upd;
  });

  it("19+20. fingerprint 参数与 selected asset 顺序变化正确", () => {
    const base = {
      projectId: "p",
      shotNodeId: "s",
      providerId: "mock",
      modelId: "m",
      generationInstruction: "hello",
      resolution: "720P",
      aspectRatio: "9:16" as const,
      durationSeconds: 5,
      selectedReferenceAssetIds: ["a", "b"],
      firstFrameAssetId: null as string | null,
    };
    const fp1 = buildGenerationRequestFingerprint(base);
    const fp2 = buildGenerationRequestFingerprint(base);
    expect(fp1).toBe(fp2);
    const fpDur = buildGenerationRequestFingerprint({
      ...base,
      durationSeconds: 8,
    });
    expect(fpDur).not.toBe(fp1);
    const fpOrder = buildGenerationRequestFingerprint({
      ...base,
      selectedReferenceAssetIds: ["b", "a"],
    });
    expect(fpOrder).not.toBe(fp1);
    // confirmPaidGeneration 不参与：无该字段；密钥不参与
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("21. 密钥和 base64 不进入持久文件", async () => {
    const key = `k-${randomUUID()}`;
    const a = await submitVideoGeneration({
      input: baseInput({ prompt: "secret-looking sk-test but only hashed" }),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: key,
    });
    generationIds.push(a.id);
    const files = await fs.readdir(storeDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    expect(jsonFiles.length).toBeGreaterThan(0);
    for (const name of jsonFiles) {
      const raw = await fs.readFile(path.join(storeDir, name), "utf8");
      expect(raw).not.toMatch(/DASHSCOPE/);
      expect(raw).not.toMatch(/data:[^;]+;base64,/i);
      expect(raw).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
      expect(raw).not.toContain("secret-looking");
      const parsed = parseIdempotencyRecord(raw);
      expect(parsed.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("22+23. build/test 不访问真实网络；默认仍 mock / paid false", async () => {
    const a = await submitVideoGeneration({
      input: baseInput(),
      unsupportedAudioLabels: [],
      confirmPaidGeneration: false,
      idempotencyKey: `net-${randomUUID()}`,
    });
    generationIds.push(a.id);
    expect(fetchCalls).toBe(0);
    expect(process.env.VIDEO_PROVIDER).toBe("mock");
    expect(process.env.ALLOW_PAID_GENERATION).toBe("false");
    const store = getIdempotencyStore();
    expect(store.backendKind).toBe("file-local");
  });

  it("fingerprint 哈希稳定（不含 Math.random）", () => {
    const h = createHash("sha256").update("x").digest("hex");
    expect(h).toHaveLength(64);
    const a = buildGenerationRequestFingerprint({
      projectId: "p",
      shotNodeId: "s",
      providerId: "mock",
      modelId: "m",
      generationInstruction: "x",
      resolution: "720P",
      aspectRatio: null,
      durationSeconds: 5,
      selectedReferenceAssetIds: [],
      firstFrameAssetId: null,
      directorSettings: { shotSize: "MS", cameraAngle: "eye" },
    });
    const b = buildGenerationRequestFingerprint({
      projectId: "p",
      shotNodeId: "s",
      providerId: "mock",
      modelId: "m",
      generationInstruction: "x",
      resolution: "720P",
      aspectRatio: null,
      durationSeconds: 5,
      selectedReferenceAssetIds: [],
      firstFrameAssetId: null,
      directorSettings: { cameraAngle: "eye", shotSize: "MS" },
    });
    expect(a).toBe(b);
  });
});
