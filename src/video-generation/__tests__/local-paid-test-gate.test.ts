import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
  LOCAL_PAID_TEST_HARD_MAX_COST_CNY,
  FileWanLocalPaidTestGuardStore,
  armLocalPaidTest,
  assertLocalPaidTestSpec,
  assertRetryGenerationBlockedForLocalPaidTest,
  buildWan27LocalPaidTestEnvironmentReadiness,
  collectLocalPaidTestSpecViolations,
  formatLocalDateYmd,
  getLocalPaidTestPublicConfig,
  getLocalPaidTestRuntimeConfig,
  parseGuardRecord,
  runLocalPaidTestSimulation,
  validateMaxCostCny,
  validateWan27OneShotPaidRequest,
  verifyLocalPaidTestToken,
  LocalPaidTestError,
} from "@/video-generation/local-paid-test";
import type { VideoGenerationInput } from "@/video-generation/types";

function t2vInput(
  patch: Partial<VideoGenerationInput> = {},
): VideoGenerationInput {
  return {
    shotId: "s1",
    projectId: "p1",
    prompt: "x",
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

describe("local paid test config defaults", () => {
  it("defaults mode off and public flags safe", () => {
    const cfg = getLocalPaidTestRuntimeConfig({
      NODE_ENV: "development",
      VIDEO_PROVIDER: "mock",
      ALLOW_PAID_GENERATION: "false",
    });
    expect(cfg.localPaidTestMode).toBe(false);
    const pub = getLocalPaidTestPublicConfig({
      NODE_ENV: "development",
      WAN_LOCAL_PAID_TEST_MODE: "false",
      VIDEO_PROVIDER: "mock",
      ALLOW_PAID_GENERATION: "false",
    });
    expect(pub.localPaidTestModeEnabled).toBe(false);
    expect(pub.realSubmitEnabled).toBe(false);
    expect(pub.tokenConfigured).toBe(false);
  });

  it("production forever rejects environment readiness path", () => {
    const readiness = buildWan27LocalPaidTestEnvironmentReadiness({
      env: fakeEnv({ NODE_ENV: "production" }),
      guardState: "armed",
      allowOneShotReadyIfConfigured: true,
    });
    expect(readiness.readyForOneShotLocalTest).toBe(false);
    expect(readiness.readyForPaidSubmission).toBe(false);
    expect(
      readiness.checks.some(
        (c) => c.key === "node_env_development" && c.status === "fail",
      ),
    ).toBe(true);
  });

  it("test env cannot open real network gate", () => {
    const readiness = buildWan27LocalPaidTestEnvironmentReadiness({
      env: fakeEnv({ NODE_ENV: "test" }),
      guardState: "armed",
      allowOneShotReadyIfConfigured: true,
    });
    expect(readiness.readyForOneShotLocalTest).toBe(false);
  });

  it("token missing / invalid / timingSafeEqual", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "guard-tok-"));
    const store = new FileWanLocalPaidTestGuardStore({
      rootDir: dir,
      namespace: "simulation",
    });
    await expect(
      armLocalPaidTest({
        env: fakeEnv({ WAN_LOCAL_PAID_TEST_TOKEN: "" }),
        store,
        token: "x",
        confirmationPhrase: LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
      }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_TOKEN_NOT_CONFIGURED" });

    await expect(
      armLocalPaidTest({
        env: fakeEnv(),
        store,
        token: "wrong-token-32chars-bbbbbbbbbbbb",
        confirmationPhrase: LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
      }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_TOKEN_INVALID" });

    expect(
      verifyLocalPaidTestToken(
        "test-token-32chars-aaaaaaaaaaaa",
        "test-token-32chars-aaaaaaaaaaaa",
      ),
    ).toBe(true);
    expect(
      verifyLocalPaidTestToken("short", "test-token-32chars-aaaaaaaaaaaa"),
    ).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("confirmation phrase and price / max cost rules", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "guard-arm-"));
    const store = new FileWanLocalPaidTestGuardStore({
      rootDir: dir,
      namespace: "simulation",
    });
    await expect(
      armLocalPaidTest({
        env: fakeEnv(),
        store,
        token: "test-token-32chars-aaaaaaaaaaaa",
        confirmationPhrase: "错误短语",
      }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_CONFIRMATION_INVALID" });

    await expect(
      armLocalPaidTest({
        env: fakeEnv({ WAN_TEST_PRICE_CONFIRMED_ON: "" }),
        store,
        token: "test-token-32chars-aaaaaaaaaaaa",
        confirmationPhrase: LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
      }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_PRICE_NOT_CONFIRMED" });

    await expect(
      armLocalPaidTest({
        env: fakeEnv({ WAN_TEST_PRICE_CONFIRMED_ON: "2000-01-01" }),
        store,
        token: "test-token-32chars-aaaaaaaaaaaa",
        confirmationPhrase: LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
      }),
    ).rejects.toMatchObject({
      code: "LOCAL_PAID_TEST_PRICE_CONFIRMATION_EXPIRED",
    });

    expect(validateMaxCostCny(null).ok).toBe(false);
    expect(validateMaxCostCny(LOCAL_PAID_TEST_HARD_MAX_COST_CNY + 1).ok).toBe(
      false,
    );
    expect(validateMaxCostCny(2).ok).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("local paid test fixed spec", () => {
  it("rejects non T2V / non 720P / non 16:9 / non 2s / refs", () => {
    expect(
      collectLocalPaidTestSpecViolations(
        t2vInput({
          imageReferences: [
            {
              assetId: "a",
              kind: "image",
              label: "i",
              mimeType: "image/png",
              sourceUrl: "/api/assets/a",
            },
          ],
          orderedReferenceMedia: [
            {
              assetId: "a",
              kind: "image",
              label: "i",
              mimeType: "image/png",
              sourceUrl: "/api/assets/a",
            },
          ],
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      collectLocalPaidTestSpecViolations(t2vInput({ resolution: "1080P" }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      collectLocalPaidTestSpecViolations(t2vInput({ aspectRatio: "9:16" }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      collectLocalPaidTestSpecViolations(t2vInput({ durationSeconds: 5 }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      collectLocalPaidTestSpecViolations(
        t2vInput({
          firstFrame: {
            assetId: "f",
            kind: "first_frame",
            label: "f",
            mimeType: "image/png",
            sourceUrl: "/x",
          },
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(() => assertLocalPaidTestSpec(t2vInput())).not.toThrow();
  });
});

describe("local paid test guard", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "guard-st-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("state machine and persistence across store rebuild", async () => {
    const store = new FileWanLocalPaidTestGuardStore({
      rootDir: dir,
      namespace: "simulation",
    });
    expect((await store.get()).state).toBe("unarmed");
    await expect(
      store.markSubmitting({ generationId: "g" }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_NOT_ARMED" });

    await store.arm({});
    expect((await store.get()).state).toBe("armed");

    await store.markSubmitting({ generationId: "g1" });
    await expect(
      store.markSubmitting({ generationId: "g2" }),
    ).rejects.toMatchObject({ code: "LOCAL_PAID_TEST_ALREADY_IN_PROGRESS" });

    await store.markProviderAccepted({
      generationId: "g1",
      providerTaskId: "sim-task",
    });
    expect((await store.get()).state).toBe("providerAccepted");

    const rebuilt = new FileWanLocalPaidTestGuardStore({
      rootDir: dir,
      namespace: "simulation",
    });
    expect((await rebuilt.get()).state).toBe("providerAccepted");

    await rebuilt.markTransferPending({
      generationId: "g1",
      providerTaskId: "sim-task",
    });
    expect((await rebuilt.get()).state).toBe("transferPending");

    await rebuilt.markCompleted({ generationId: "g1" });
    expect((await rebuilt.get()).state).toBe("completed");
    await rebuilt.markConsumed();
    expect((await rebuilt.get()).state).toBe("consumed");
  });

  it("failedBeforeSubmit can re-arm; unknownOutcome blocks", async () => {
    const store = new FileWanLocalPaidTestGuardStore({
      rootDir: dir,
      namespace: "simulation",
    });
    await store.arm({});
    await store.markFailedBeforeSubmit({ errorCode: "X" });
    await store.arm({});
    expect((await store.get()).state).toBe("armed");

    await store.markSubmitting({ generationId: "g" });
    await store.markUnknownOutcome({ errorCode: "U" });
    await expect(store.arm({})).rejects.toMatchObject({
      code: "LOCAL_PAID_TEST_UNKNOWN_OUTCOME",
    });
  });

  it("corrupted guard and no secrets in file", async () => {
    const store = new FileWanLocalPaidTestGuardStore({
      rootDir: dir,
      namespace: "simulation",
    });
    await store.arm({});
    const file = path.join(dir, "simulation-one-shot-guard.json");
    const raw = await fs.readFile(file, "utf8");
    expect(raw).not.toContain("token");
    expect(raw).not.toContain("sk-");
    expect(raw).not.toContain("prompt");
    expect(raw).not.toContain("base64");
    expect(raw).not.toContain("https://");

    await fs.writeFile(file, "{not-json", "utf8");
    await expect(store.get()).rejects.toBeInstanceOf(LocalPaidTestError);

    expect(() =>
      parseGuardRecord(
        JSON.stringify({
          version: 1,
          state: "armed",
          token: "secret",
          updatedAt: new Date().toISOString(),
        }),
      ),
    ).toThrow(LocalPaidTestError);
  });
});

describe("local paid test readiness", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(() => {
      throw new Error("network forbidden");
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("default readyForPaidSubmission false; allowlist empty keeps SSRF", () => {
    const r = buildWan27LocalPaidTestEnvironmentReadiness({
      env: {
        NODE_ENV: "development",
        VIDEO_PROVIDER: "mock",
        ALLOW_PAID_GENERATION: "false",
        WAN_LOCAL_PAID_TEST_MODE: "false",
        WAN_RESULT_ALLOWED_HOSTS: "",
      },
      guardState: "unarmed",
    });
    expect(r.readyForPaidSubmission).toBe(false);
    expect(r.readyForOneShotLocalTest).toBe(false);
    expect(r.readyForResultTransfer).toBe(false);
    expect(r.allowlistEmptyWarning).toMatch(/转存会被阻止/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("injected full fake config can pass one-shot readiness without mutating guard", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "guard-ready-"));
    const store = new FileWanLocalPaidTestGuardStore({
      rootDir: dir,
      namespace: "simulation",
    });
    const before = await store.get();
    const r = buildWan27LocalPaidTestEnvironmentReadiness({
      env: fakeEnv(),
      guardState: "armed",
      allowOneShotReadyIfConfigured: true,
    });
    expect(r.readyForOneShotLocalTest).toBe(true);
    expect(r.readyForPaidSubmission).toBe(false);
    expect((await store.get()).state).toBe(before.state);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    const req = validateWan27OneShotPaidRequest({
      generationInput: t2vInput({ resolution: "1080P" }),
      confirmPaidGeneration: true,
      confirmationPhrase: LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
      guardState: "armed",
    });
    expect(req.ok).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("local paid test simulation", () => {
  it("happy path and unknownOutcome without network or formal records", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sim-happy-"));
    const happy = await runLocalPaidTestSimulation({
      rootDir: dir,
      scenario: "happy-path",
    });
    expect(happy.simulation).toBe(true);
    expect(happy.calledNetwork).toBe(false);
    expect(happy.createdFormalGeneration).toBe(false);
    expect(happy.createdFormalIdempotency).toBe(false);
    expect(happy.createdFormalVideoAsset).toBe(false);
    expect(happy.fakeProviderTaskId.startsWith("sim-fake-task-")).toBe(true);
    expect(happy.steps.some((s) => s.step === "retry_generation_blocked" && s.ok)).toBe(
      true,
    );
    expect(happy.steps.some((s) => s.step === "retry_transfer_allowed" && s.ok)).toBe(
      true,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    await fs.rm(dir, { recursive: true, force: true });

    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), "sim-unk-"));
    const unk = await runLocalPaidTestSimulation({
      rootDir: dir2,
      scenario: "unknown-outcome",
    });
    expect(unk.finalGuard.state).toBe("unknownOutcome");
    expect(fetchSpy).not.toHaveBeenCalled();
    await fs.rm(dir2, { recursive: true, force: true });

    expect(() =>
      assertRetryGenerationBlockedForLocalPaidTest("providerAccepted"),
    ).toThrow(LocalPaidTestError);
  });
});

describe("token never enters guard payload", () => {
  it("arm does not persist token", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "guard-sec-"));
    const store = new FileWanLocalPaidTestGuardStore({
      rootDir: dir,
      namespace: "simulation",
    });
    await armLocalPaidTest({
      env: fakeEnv(),
      store,
      token: "test-token-32chars-aaaaaaaaaaaa",
      confirmationPhrase: LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
    });
    const raw = await fs.readFile(
      path.join(dir, "simulation-one-shot-guard.json"),
      "utf8",
    );
    expect(raw).not.toContain("test-token-32chars-aaaaaaaaaaaa");
    expect(raw).not.toContain("sk-fake");
    await fs.rm(dir, { recursive: true, force: true });
  });
});
