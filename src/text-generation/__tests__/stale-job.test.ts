import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  getCreditBalance,
  getFrozenCredits,
  reserveCredits,
} from "@/text-generation/credits";
import { getTextJob, saveTextJob } from "@/text-generation/job-store";
import {
  isStaleTextJob,
  reclaimStaleTextJob,
} from "@/text-generation/stale-job";
import type { TextGenerationJob } from "@/text-generation/types";

function baseJob(overrides: Partial<TextGenerationJob> = {}): TextGenerationJob {
  return {
    generationId: "tg_stale_test_001",
    projectId: "proj_stale",
    userId: "user_stale",
    outputKind: "episode_asset_design",
    modelKey: "balanced-default",
    displayModelName: "mock",
    providerModelId: "mock",
    brief: "x",
    targetChars: 1000,
    status: "running",
    content: "",
    actualChars: 0,
    inputTokens: null,
    outputTokens: null,
    reservedPoints: 10,
    chargedPoints: 0,
    idempotencyKey: "idem_stale",
    documentId: null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

describe("stale text generation jobs", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-stale-job-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("detects running jobs past the timeout window as stale", () => {
    const now = Date.parse("2026-08-04T01:00:00.000Z");
    expect(
      isStaleTextJob(
        baseJob({ updatedAt: "2026-08-04T00:00:00.000Z" }),
        now,
        170_000,
      ),
    ).toBe(true);
    expect(
      isStaleTextJob(
        baseJob({
          updatedAt: new Date(now - 60_000).toISOString(),
        }),
        now,
        170_000,
      ),
    ).toBe(false);
    expect(
      isStaleTextJob(
        baseJob({
          status: "completed",
          updatedAt: "2026-08-04T00:00:00.000Z",
        }),
        now,
        170_000,
      ),
    ).toBe(false);
  });

  it("does not treat script_asset_design as stale at 185s", () => {
    const updatedAt = "2026-08-14T08:00:46.122Z";
    const now = Date.parse(updatedAt) + 185_000;
    expect(
      isStaleTextJob(
        baseJob({
          outputKind: "script_asset_design",
          updatedAt,
        }),
        now,
      ),
    ).toBe(false);
  });

  it("marks script_asset_design stale after dedicated timeout plus grace", () => {
    const updatedAt = "2026-08-14T08:00:46.122Z";
    const timeoutMs = 600_000;
    const now = Date.parse(updatedAt) + timeoutMs + 15_000 + 1;
    expect(
      isStaleTextJob(
        baseJob({
          outputKind: "script_asset_design",
          updatedAt,
        }),
        now,
      ),
    ).toBe(true);
  });

  it("reclaims a stale job and releases its credit reservation", async () => {
    const job = baseJob();
    await saveTextJob(job);
    await reserveCredits({
      userId: job.userId,
      points: 64,
      generationId: job.generationId,
      projectId: job.projectId,
      reason: "text-generation-reserve",
    });
    expect(await getFrozenCredits(job.userId)).toBe(64);

    const reclaimed = await reclaimStaleTextJob(job);
    expect(reclaimed.status).toBe("failed");
    expect(reclaimed.errorCode).toBe("STALE_JOB");

    const stored = await getTextJob(job.projectId, job.generationId);
    expect(stored?.status).toBe("failed");
    expect(stored?.errorCode).toBe("STALE_JOB");
    expect(await getFrozenCredits(job.userId)).toBe(0);
    expect(await getCreditBalance(job.userId)).toBeGreaterThanOrEqual(10000);
  });
});
