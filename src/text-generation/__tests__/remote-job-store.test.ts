import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextGenerationJob } from "@/text-generation/types";

const catalogs = vi.hoisted(() => new Map<string, TextGenerationJob[]>());

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, "http://go-backend.internal");
    if ((init.method ?? "GET") === "POST") {
      const job = JSON.parse(String(init.body)) as TextGenerationJob;
      await Promise.resolve();
      const jobs = catalogs.get(job.projectId) ?? [];
      const index = jobs.findIndex(
        (candidate) => candidate.generationId === job.generationId,
      );
      if (index >= 0) jobs[index] = structuredClone(job);
      else jobs.push(structuredClone(job));
      catalogs.set(job.projectId, jobs);
      return Response.json({ ok: true });
    }

    const projectId = url.searchParams.get("projectId") ?? "";
    const jobs = structuredClone(catalogs.get(projectId) ?? []);
    const generationId = url.searchParams.get("generationId");
    const userId = url.searchParams.get("userId");
    const idempotencyKey = url.searchParams.get("idempotencyKey");
    const running = url.searchParams.get("running") === "true";
    if (generationId || idempotencyKey || running) {
      const job = jobs.find((candidate) => {
        if (generationId && candidate.generationId !== generationId) return false;
        if (userId && candidate.userId !== userId) return false;
        if (idempotencyKey && candidate.idempotencyKey !== idempotencyKey) {
          return false;
        }
        if (
          running &&
          candidate.status !== "queued" &&
          candidate.status !== "running"
        ) {
          return false;
        }
        return true;
      });
      return Response.json({ job: job ?? null });
    }
    return Response.json({ jobs });
  }),
}));

import {
  findJobByIdempotency,
  findRunningTextJob,
  getTextJob,
  listTextJobs,
  saveTextJob,
} from "@/text-generation/job-store";

function job(
  generationId: string,
  status: TextGenerationJob["status"] = "queued",
) {
  return {
    generationId,
    projectId: "project_1",
    userId: "user_1",
    outputKind: "asset_design_prompt" as const,
    modelKey: "mock",
    displayModelName: "Mock",
    providerModelId: "mock",
    brief: "prompt",
    targetChars: 100,
    status,
    content: "",
    actualChars: 0,
    inputTokens: null,
    outputTokens: null,
    reservedPoints: 0,
    chargedPoints: 0,
    idempotencyKey: `idem_${generationId}`,
    documentId: null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } satisfies TextGenerationJob;
}

describe("remote text generation job store", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-text-jobs-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    catalogs.clear();
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("saves, updates, and queries jobs without local files", async () => {
    await saveTextJob(job("job_1"));
    await saveTextJob({ ...job("job_1"), status: "completed", content: "done" });

    expect((await getTextJob("project_1", "job_1"))?.status).toBe("completed");
    expect(await findRunningTextJob("project_1", "user_1")).toBeNull();
    expect(
      (await findJobByIdempotency("project_1", "user_1", "idem_job_1"))
        ?.content,
    ).toBe("done");
    expect(await listTextJobs("project_1")).toHaveLength(1);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("preserves separate jobs during concurrent saves", async () => {
    await Promise.all([
      saveTextJob(job("job_1", "completed")),
      saveTextJob(job("job_2", "running")),
    ]);

    expect(
      (await listTextJobs("project_1"))
        .map((item) => item.generationId)
        .sort(),
    ).toEqual(["job_1", "job_2"]);
    expect((await findRunningTextJob("project_1", "user_1"))?.generationId).toBe(
      "job_2",
    );
  });

  it("isolates catalogs by project", async () => {
    await saveTextJob(job("job_1"));
    await saveTextJob({ ...job("job_2"), projectId: "project_2" });

    expect(await listTextJobs("project_1")).toHaveLength(1);
    expect(await listTextJobs("project_2")).toHaveLength(1);
  });
});