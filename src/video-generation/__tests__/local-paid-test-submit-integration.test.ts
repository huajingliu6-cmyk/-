import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
  FileWanLocalPaidTestGuardStore,
  FakeLocalPaidTestVideoProvider,
  armLocalPaidTest,
  assertPaidGenerationSubmissionPolicy,
  formatLocalDateYmd,
  hashLocalPaidTestArmNonce,
  setLocalPaidTestGuardStoreForTests,
  submitWan27LocalOneShotPaidTest,
  validateLocalPaidTestRequestOrigin,
  verifyLocalPaidTestArmNonce,
  LocalPaidTestError,
} from "@/video-generation/local-paid-test";
import {
  FileGenerationIdempotencyStore,
  setIdempotencyStoreForTests,
} from "@/video-generation/idempotency";
import {
  readGenerationRecord,
  setGenerationStoreRootForTests,
  updateGenerationRecord,
} from "@/video-generation/generation-store";
import {
  retryTransferGeneration,
  retryVideoGeneration,
  submitVideoGeneration,
} from "@/video-generation/service";
import { getVideoProviderRuntimeConfig } from "@/video-generation/provider/config";
import type { VideoGenerationInput } from "@/video-generation/types";

function t2vInput(
  patch: Partial<VideoGenerationInput> = {},
): VideoGenerationInput {
  return {
    shotId: "shot-one-shot",
    projectId: "project-one-shot",
    prompt: "zero-network local one-shot prompt",
    resolution: "720P",
    aspectRatio: "16:9",
    durationSeconds: 2,
    watermark: false,
    promptExtend: false,
    characterReferences: [],
    sceneReferences: [],
    imageReferences: [],
    referenceVideos: [],
    orderedReferenceMedia: [],
    textInputs: [],
    referenceSelectionMode: "auto",
    selectedReferenceAssetIds: [],
    ...patch,
  };
}

function fakeEnv(
  patch: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "development",
    WAN_LOCAL_PAID_TEST_MODE: "true",
    WAN_LOCAL_PAID_TEST_TOKEN: "test-token-32chars-aaaaaaaaaaaa",
    WAN_TEST_PRICE_CONFIRMED_ON: formatLocalDateYmd(),
    WAN_TEST_MAX_COST_CNY: "2",
    WAN_TEST_MAX_TASKS: "1",
    VIDEO_PROVIDER: "aliyun-wan27",
    ALLOW_PAID_GENERATION: "true",
    DASHSCOPE_API_KEY: "sk-fake-not-real",
    DASHSCOPE_WORKSPACE_ID: "ws-fake",
    DASHSCOPE_REGION: "cn-beijing",
    WAN_T2V_MODEL_ID: "wan2.7-t2v-2026-06-12",
    WAN_R2V_MODEL_ID: "wan2.7-r2v-2026-06-12",
    WAN_RESULT_ALLOWED_HOSTS: "",
    ...patch,
  };
}

describe("阶段 3D-B6-C 零网络一次性提交集成", () => {
  const originalFetch = globalThis.fetch;
  let root: string;
  let guardDir: string;
  let genDir: string;
  let idemDir: string;
  let guardStore: FileWanLocalPaidTestGuardStore;
  let idemStore: FileGenerationIdempotencyStore;
  let fakeProvider: FakeLocalPaidTestVideoProvider;
  let env: Record<string, string | undefined>;
  let fetchCalls = 0;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "one-shot-int-"));
    guardDir = path.join(root, "guard");
    genDir = path.join(root, "generations");
    idemDir = path.join(root, "idempotency");
    await fs.mkdir(guardDir, { recursive: true });
    await fs.mkdir(genDir, { recursive: true });
    await fs.mkdir(idemDir, { recursive: true });

    guardStore = new FileWanLocalPaidTestGuardStore({
      rootDir: guardDir,
      namespace: "live",
    });
    idemStore = new FileGenerationIdempotencyStore(idemDir);
    setLocalPaidTestGuardStoreForTests(guardStore);
    setIdempotencyStoreForTests(idemStore);
    setGenerationStoreRootForTests(genDir);

    env = fakeEnv();
    fakeProvider = new FakeLocalPaidTestVideoProvider({
      behavior: "success",
    });

    fetchCalls = 0;
    globalThis.fetch = ((..._unused: Parameters<typeof fetch>) => {
      void _unused;
      fetchCalls += 1;
      throw new Error("network forbidden in zero-network tests");
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    setLocalPaidTestGuardStoreForTests(null);
    setIdempotencyStoreForTests(null);
    setGenerationStoreRootForTests(null);
    await fs.rm(root, { recursive: true, force: true });
  });

  async function arm(): Promise<string> {
    const { armNonce } = await armLocalPaidTest({
      env,
      store: guardStore,
      token: "test-token-32chars-aaaaaaaaaaaa",
      confirmationPhrase: LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
    });
    return armNonce;
  }

  async function submit(opts: {
    armNonce: string;
    idempotencyKey?: string;
    input?: VideoGenerationInput;
    provider?: FakeLocalPaidTestVideoProvider;
    confirmPaidGeneration?: boolean;
    token?: string;
    phrase?: string;
    rejectedClientFields?: string[];
  }) {
    const input = opts.input ?? t2vInput();
    return submitWan27LocalOneShotPaidTest({
      env,
      guardStore,
      idempotencyStore: idemStore,
      provider: opts.provider ?? fakeProvider,
      generationInput: input,
      runtimeConfig: getVideoProviderRuntimeConfig(env),
      rejectedClientFields: opts.rejectedClientFields,
      client: {
        projectId: input.projectId,
        shotNodeId: input.shotId,
        confirmPaidGeneration: opts.confirmPaidGeneration ?? true,
        token: opts.token ?? "test-token-32chars-aaaaaaaaaaaa",
        confirmationPhrase:
          opts.phrase ?? LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
        armNonce: opts.armNonce,
        idempotencyKey: opts.idempotencyKey ?? `idem-${randomUUID()}`,
      },
    });
  }

  it("1-18 happy path: arm → submit → transferPending → retryTransfer → completed → consumed", async () => {
    await expect(
      submit({ armNonce: "nope", idempotencyKey: "k1" }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_NOT_ARMED" });

    const nonce = await arm();
    expect(nonce.length).toBeGreaterThan(20);
    const guardArmed = await guardStore.get();
    expect(guardArmed.state).toBe("armed");
    expect(guardArmed.armNonceHash).toBe(hashLocalPaidTestArmNonce(nonce));
    expect(JSON.stringify(guardArmed)).not.toContain(nonce);

    const record = await submit({ armNonce: nonce, idempotencyKey: "k-happy" });
    expect(fakeProvider.getSubmitCount()).toBe(1);
    expect(record.localOneShotPaidTest).toBe(true);
    expect(record.providerTaskId).toBeTruthy();
    expect(record.idempotencyKey).toBe("k-happy");
    expect(JSON.stringify(record)).not.toContain(nonce);
    expect(JSON.stringify(record)).not.toContain(
      "test-token-32chars-aaaaaaaaaaaa",
    );

    const afterSubmit = await guardStore.get();
    expect(afterSubmit.state).toBe("providerAccepted");
    expect(afterSubmit.providerTaskId).toBe(record.providerTaskId);
    expect(afterSubmit.generationId).toBe(record.id);

    // Simulate Provider SUCCEEDED + allowlist-empty transfer failure without network
    const status = await fakeProvider.getGenerationStatus(record.providerTaskId);
    await updateGenerationRecord(record.id, {
      status: "resultTransferFailed",
      errorCode: "RESULT_HOST_ALLOWLIST_NOT_CONFIGURED",
      errorMessage: "allowlist empty",
      remoteVideoUrl: status.remoteVideoUrl ?? null,
      providerResolution: status.providerResolution ?? null,
      providerAspectRatio: status.providerAspectRatio ?? null,
      providerDurationSeconds: status.providerDurationSeconds ?? null,
    });
    await guardStore.markTransferPending({
      generationId: record.id,
      providerTaskId: record.providerTaskId,
    });
    expect((await guardStore.get()).state).toBe("transferPending");

    const submitCountBeforeRetry = fakeProvider.getSubmitCount();
    await expect(retryTransferGeneration(record.id)).rejects.toBeTruthy();
    expect(fakeProvider.getSubmitCount()).toBe(submitCountBeforeRetry);
    expect((await guardStore.get()).state).toBe("transferPending");

    await updateGenerationRecord(record.id, {
      status: "completed",
      progressLabel: "已完成",
      completedAt: new Date().toISOString(),
      resultAsset: {
        id: "asset-fake",
        projectId: record.projectId,
        assetType: "generatedVideo",
        name: "fake",
        originalFileName: "fake.mp4",
        mimeType: "video/mp4",
        sizeBytes: 1024,
        url: "/api/assets/asset-fake",
        thumbnailUrl: "",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      localVideoAssetId: "asset-fake",
    });
    const completed = await readGenerationRecord(record.id);
    expect(completed?.status).toBe("completed");
    await guardStore.markCompleted({
      generationId: record.id,
      providerTaskId: record.providerTaskId,
    });
    expect((await guardStore.get()).state).toBe("completed");
    await guardStore.markConsumed();
    expect((await guardStore.get()).state).toBe("consumed");
    expect(fetchCalls).toBe(0);
  });

  it("19-30 bypass and origin: normal API / forbidden fields / host / origin / production", async () => {
    expect(() =>
      assertPaidGenerationSubmissionPolicy({
        source: "normalGenerationApi",
        runtimeConfig: getVideoProviderRuntimeConfig(env),
        env,
      }),
    ).toThrow(LocalPaidTestError);

    const prevProvider = process.env.VIDEO_PROVIDER;
    const prevPaid = process.env.ALLOW_PAID_GENERATION;
    const prevKey = process.env.DASHSCOPE_API_KEY;
    const prevWs = process.env.DASHSCOPE_WORKSPACE_ID;
    process.env.VIDEO_PROVIDER = "aliyun-wan27";
    process.env.ALLOW_PAID_GENERATION = "true";
    process.env.DASHSCOPE_API_KEY = "sk-fake-not-real";
    process.env.DASHSCOPE_WORKSPACE_ID = "ws-fake";
    try {
      await expect(
        submitVideoGeneration({
          input: t2vInput({ shotId: `bypass-${randomUUID()}` }),
          unsupportedAudioLabels: [],
          confirmPaidGeneration: true,
        }),
      ).rejects.toMatchObject({
        code: "PAID_SUBMISSION_REQUIRES_LOCAL_TEST_GATE",
      });
    } finally {
      if (prevProvider === undefined) delete process.env.VIDEO_PROVIDER;
      else process.env.VIDEO_PROVIDER = prevProvider;
      if (prevPaid === undefined) delete process.env.ALLOW_PAID_GENERATION;
      else process.env.ALLOW_PAID_GENERATION = prevPaid;
      if (prevKey === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = prevKey;
      if (prevWs === undefined) delete process.env.DASHSCOPE_WORKSPACE_ID;
      else process.env.DASHSCOPE_WORKSPACE_ID = prevWs;
    }

    const nonce = await arm();
    await expect(
      submit({
        armNonce: nonce,
        rejectedClientFields: ["providerId"],
        input: t2vInput({ shotId: `forbid-${randomUUID()}` }),
      }),
    ).rejects.toMatchObject({
      code: "LOCAL_PAID_TEST_CLIENT_FIELD_FORBIDDEN",
    });

    expect(() =>
      validateLocalPaidTestRequestOrigin({
        host: "evil.example.com",
        origin: "http://evil.example.com",
      }),
    ).toThrowError(/环回|Origin|拒绝/);

    expect(() =>
      validateLocalPaidTestRequestOrigin({
        host: "127.0.0.1:3000",
        origin: "null",
      }),
    ).toThrow(LocalPaidTestError);

    expect(() =>
      validateLocalPaidTestRequestOrigin({
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        secFetchSite: "cross-site",
      }),
    ).toThrow(LocalPaidTestError);

    expect(() =>
      validateLocalPaidTestRequestOrigin({
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        xForwardedFor: "8.8.8.8",
      }),
    ).toThrow(LocalPaidTestError);

    expect(
      validateLocalPaidTestRequestOrigin({
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        secFetchSite: "same-origin",
      }).ok,
    ).toBe(true);

    await expect(
      armLocalPaidTest({
        env: fakeEnv({ NODE_ENV: "production" }),
        store: guardStore,
        token: "test-token-32chars-aaaaaaaaaaaa",
        confirmationPhrase: LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
      }),
    ).rejects.toMatchObject({
      code: "LOCAL_PAID_TEST_NOT_ALLOWED_IN_PRODUCTION",
    });

    const mockRuntime = getVideoProviderRuntimeConfig({
      VIDEO_PROVIDER: "mock",
      ALLOW_PAID_GENERATION: "false",
    });
    expect(() =>
      assertPaidGenerationSubmissionPolicy({
        source: "normalGenerationApi",
        runtimeConfig: mockRuntime,
      }),
    ).not.toThrow();
  });

  it("31-42 token / phrase / nonce semantics", async () => {
    await expect(
      submit({
        armNonce: "x",
        token: "",
      }),
    ).rejects.toBeTruthy();

    const nonce = await arm();
    await expect(
      submit({
        armNonce: nonce,
        token: "wrong-token-32chars-bbbbbbbbbbbb",
      }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_TOKEN_INVALID" });

    await expect(
      submit({
        armNonce: nonce,
        phrase: "错误短语",
      }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_CONFIRMATION_INVALID" });

    await expect(
      submit({ armNonce: "" }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_NONCE_REQUIRED" });

    await expect(
      submit({ armNonce: "totally-wrong-nonce-value-xxxxxx" }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_NONCE_INVALID" });

    const rotated = await arm();
    expect(verifyLocalPaidTestArmNonce(nonce, (await guardStore.get()).armNonceHash)).toBe(
      false,
    );
    await expect(
      submit({ armNonce: nonce, idempotencyKey: "old-nonce" }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_NONCE_INVALID" });

    const first = await submit({
      armNonce: rotated,
      idempotencyKey: "same-fp-key",
    });
    expect(fakeProvider.getSubmitCount()).toBe(1);

    const second = await submit({
      armNonce: rotated,
      idempotencyKey: "same-fp-key",
    });
    expect(second.id).toBe(first.id);
    expect(fakeProvider.getSubmitCount()).toBe(1);

    // same nonce different fingerprint (different shot)
    await expect(
      submit({
        armNonce: rotated,
        idempotencyKey: "diff-fp",
        input: t2vInput({ shotId: "other-shot", prompt: "other" }),
      }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_REQUEST_MISMATCH" });

    const idemRaw = await fs.readdir(idemDir);
    for (const name of idemRaw) {
      const content = await fs.readFile(path.join(idemDir, name), "utf8");
      expect(content).not.toContain(rotated);
      expect(content).not.toContain("test-token-32chars-aaaaaaaaaaaa");
    }
    const genRaw = await fs.readFile(
      path.join(genDir, `${first.id}.json`),
      "utf8",
    );
    expect(genRaw).not.toContain(rotated);
    expect(fetchCalls).toBe(0);
  });

  it("43-53 failures, unknown, retry policies, multi-tab", async () => {
    const failProvider = new FakeLocalPaidTestVideoProvider({
      behavior: "failBeforeAccept",
    });
    const nonce1 = await arm();
    await expect(
      submit({
        armNonce: nonce1,
        provider: failProvider,
        idempotencyKey: "fail-before",
        input: t2vInput({ shotId: `fail-${randomUUID()}` }),
      }),
    ).rejects.toBeTruthy();
    expect((await guardStore.get()).state).toBe("failedBeforeSubmit");

    const unkProvider = new FakeLocalPaidTestVideoProvider({
      behavior: "unknownOutcome",
    });
    const nonce2 = await arm();
    await expect(
      submit({
        armNonce: nonce2,
        provider: unkProvider,
        idempotencyKey: "unk",
        input: t2vInput({ shotId: `unk-${randomUUID()}` }),
      }),
    ).rejects.toMatchObject({ code: "GENERATION_SUBMISSION_UNKNOWN" });
    expect((await guardStore.get()).state).toBe("unknownOutcome");

    await fs.rm(guardDir, { recursive: true, force: true });
    await fs.mkdir(guardDir, { recursive: true });
    guardStore = new FileWanLocalPaidTestGuardStore({
      rootDir: guardDir,
      namespace: "live",
    });
    setLocalPaidTestGuardStoreForTests(guardStore);

    const failedProv = new FakeLocalPaidTestVideoProvider({
      behavior: "providerFailed",
    });
    const nonce3 = await arm();
    const failedShot = `prov-fail-${randomUUID()}`;
    const failedRec = await submit({
      armNonce: nonce3,
      provider: failedProv,
      idempotencyKey: `prov-fail-${randomUUID()}`,
      input: t2vInput({ shotId: failedShot }),
    });
    const failedStatus = await failedProv.getGenerationStatus(
      failedRec.providerTaskId,
    );
    await updateGenerationRecord(failedRec.id, {
      status: failedStatus.status,
      errorCode: failedStatus.errorCode ?? null,
      errorMessage: failedStatus.errorMessage ?? null,
    });
    const { syncLocalPaidTestGuardFromGeneration } = await import(
      "@/video-generation/local-paid-test"
    );
    await syncLocalPaidTestGuardFromGeneration({
      generation: (await readGenerationRecord(failedRec.id))!,
      guardStore,
    });
    expect((await guardStore.get()).state).toBe("consumed");

    await fs.rm(guardDir, { recursive: true, force: true });
    await fs.mkdir(guardDir, { recursive: true });
    guardStore = new FileWanLocalPaidTestGuardStore({
      rootDir: guardDir,
      namespace: "live",
    });
    setLocalPaidTestGuardStoreForTests(guardStore);

    const cancelProv = new FakeLocalPaidTestVideoProvider({
      behavior: "providerCanceled",
    });
    const nonce4 = await arm();
    const cancelRec = await submit({
      armNonce: nonce4,
      provider: cancelProv,
      idempotencyKey: `prov-cancel-${randomUUID()}`,
      input: t2vInput({ shotId: `cancel-${randomUUID()}` }),
    });
    const cancelStatus = await cancelProv.getGenerationStatus(
      cancelRec.providerTaskId,
    );
    await updateGenerationRecord(cancelRec.id, {
      status: cancelStatus.status,
    });
    await syncLocalPaidTestGuardFromGeneration({
      generation: (await readGenerationRecord(cancelRec.id))!,
      guardStore,
    });
    expect((await guardStore.get()).state).toBe("consumed");

    await fs.rm(guardDir, { recursive: true, force: true });
    await fs.mkdir(guardDir, { recursive: true });
    guardStore = new FileWanLocalPaidTestGuardStore({
      rootDir: guardDir,
      namespace: "live",
    });
    setLocalPaidTestGuardStoreForTests(guardStore);

    const unknownProv = new FakeLocalPaidTestVideoProvider({
      behavior: "providerUnknown",
    });
    const nonce5 = await arm();
    const unkRec = await submit({
      armNonce: nonce5,
      provider: unknownProv,
      idempotencyKey: `prov-unknown-${randomUUID()}`,
      input: t2vInput({ shotId: `pun-${randomUUID()}` }),
    });
    const unkStatus = await unknownProv.getGenerationStatus(
      unkRec.providerTaskId,
    );
    await updateGenerationRecord(unkRec.id, {
      status: unkStatus.status,
      errorCode: unkStatus.errorCode ?? "PROVIDER_TASK_UNKNOWN",
      errorMessage: unkStatus.errorMessage ?? null,
    });
    await syncLocalPaidTestGuardFromGeneration({
      generation: (await readGenerationRecord(unkRec.id))!,
      guardStore,
    });
    expect((await guardStore.get()).state).toBe("unknownOutcome");

    const prevMode = process.env.WAN_LOCAL_PAID_TEST_MODE;
    process.env.WAN_LOCAL_PAID_TEST_MODE = "true";
    try {
      await expect(
        retryVideoGeneration({
          previousGenerationId: unkRec.id,
          input: t2vInput({ shotId: unkRec.shotNodeId }),
          unsupportedAudioLabels: [],
          confirmPaidGeneration: true,
          idempotencyKey: `retry-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/LOCAL_PAID_TEST|PAID_SUBMISSION/),
      });
    } finally {
      if (prevMode === undefined) delete process.env.WAN_LOCAL_PAID_TEST_MODE;
      else process.env.WAN_LOCAL_PAID_TEST_MODE = prevMode;
    }

    expect(fetchCalls).toBe(0);
  });

  it("54-62 isolation: no formal dirs / defaults still safe", async () => {
    const formalGuard = path.join(
      process.cwd(),
      "data",
      "paid-test-guard",
      "local-one-shot-guard.json",
    );
    const before = await fs.readFile(formalGuard, "utf8").catch(() => null);

    const nonce = await arm();
    await submit({ armNonce: nonce, idempotencyKey: "iso" });

    const after = await fs.readFile(formalGuard, "utf8").catch(() => null);
    expect(after).toEqual(before);

    const defaultCfg = getVideoProviderRuntimeConfig({
      VIDEO_PROVIDER: undefined,
      ALLOW_PAID_GENERATION: undefined,
      WAN_RESULT_ALLOWED_HOSTS: undefined,
    });
    expect(defaultCfg.providerId).toBe("mock");
    expect(defaultCfg.allowPaidGeneration).toBe(false);
    expect(fetchCalls).toBe(0);
    expect(fakeProvider.simulation).toBe(true);
    expect(fakeProvider.isFakeLocalPaidTestProvider).toBe(true);
  });
});

describe("request origin unit", () => {
  it("rejects file origin, 0.0.0.0, lan, missing origin", () => {
    expect(() =>
      validateLocalPaidTestRequestOrigin({
        host: "127.0.0.1:3000",
        origin: "file:///tmp",
      }),
    ).toThrow(LocalPaidTestError);
    expect(() =>
      validateLocalPaidTestRequestOrigin({
        host: "0.0.0.0:3000",
        origin: "http://0.0.0.0:3000",
      }),
    ).toThrow(LocalPaidTestError);
    expect(() =>
      validateLocalPaidTestRequestOrigin({
        host: "192.168.1.2:3000",
        origin: "http://192.168.1.2:3000",
      }),
    ).toThrow(LocalPaidTestError);
    expect(() =>
      validateLocalPaidTestRequestOrigin({
        host: "127.0.0.1:3000",
        origin: undefined,
      }),
    ).toThrow(LocalPaidTestError);
  });
});
