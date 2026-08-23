import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageGenerationJob } from "@/projects/assets/image-generation/types";

const jobsById = vi.hoisted(() => new Map<string, ImageGenerationJob>());
const projectIndex = vi.hoisted(() => new Map<string, string[]>());

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, "http://go-backend.internal");
    if ((init.method ?? "GET") === "POST") {
      const job = JSON.parse(String(init.body)) as ImageGenerationJob;
      jobsById.set(job.id, structuredClone(job));
      const ids = projectIndex.get(job.projectId) ?? [];
      if (!ids.includes(job.id)) {
        projectIndex.set(job.projectId, [...ids, job.id]);
      }
      return Response.json({ ok: true });
    }

    const id = url.searchParams.get("id");
    if (id) {
      return Response.json({ job: jobsById.get(id) ?? null });
    }

    const projectId = url.searchParams.get("projectId") ?? "";
    const scope = url.searchParams.get("scope") ?? "";
    const subjectId = url.searchParams.get("subjectId") ?? "";
    const subjectKind = url.searchParams.get("subjectKind") ?? "";
    const idempotencyKey = url.searchParams.get("idempotencyKey") ?? "";
    const active = url.searchParams.get("active") === "true";
    const jobs = (projectIndex.get(projectId) ?? [])
      .map((jobId) => jobsById.get(jobId))
      .filter((job): job is ImageGenerationJob => Boolean(job))
      .filter((job) => {
        if (scope && job.scope !== scope) return false;
        if (subjectId && job.subjectId !== subjectId) return false;
        if (subjectKind && job.subjectKind !== subjectKind) return false;
        if (idempotencyKey && job.idempotencyKey !== idempotencyKey) return false;
        if (
          active &&
          job.status !== "queued" &&
          job.status !== "running" &&
          job.status !== "saving" &&
          job.status !== "timed_out_waiting"
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    if (idempotencyKey || (active && subjectKind && subjectId)) {
      return Response.json({ job: jobs[0] ?? null });
    }
    return Response.json({ jobs });
  }),
}));

import {
  findActiveImageJobForSubject,
  findImageJobByIdempotencyKey,
  readImageGenerationJob,
  saveImageGenerationJob,
} from "@/projects/assets/image-generation/store";

function baseJob(overrides: Partial<ImageGenerationJob> = {}): ImageGenerationJob {
  return {
    recordType: "image",
    id: "img_test123",
    projectId: "project_1",
    scope: "management",
    subjectKind: "design_item",
    subjectId: "item_1",
    assetKind: "character",
    episodeId: "ep_1",
    actorUserId: "user_1",
    status: "queued",
    params: {
      prompt: "hello",
      mode: "text_to_image",
    },
    idempotencyKey: "idem_1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    waitDeadlineAt: null,
    errorCode: null,
    errorMessage: null,
    errorFields: [],
    mediaIds: [],
    primaryMediaId: null,
    mimeType: null,
    savedToLibrary: false,
    saveErrorMessage: null,
    notificationSent: false,
    estimatedPercent: 4,
    creditReservationId: "res_1",
    workerInstanceId: "worker_1",
    leaseToken: "lease_1",
    heartbeatAt: "2026-08-01T00:00:00.000Z",
    providerTaskId: null,
    resultClaimed: false,
    sourceEntry: "design_item",
    ...overrides,
  };
}

describe("remote image generation job store", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-image-jobs-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.REMOTE_DATA_ONLY = "true";
    jobsById.clear();
    projectIndex.clear();
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("saves and reads jobs without local files", async () => {
    await saveImageGenerationJob(baseJob());
    const loaded = await readImageGenerationJob("img_test123");
    expect(loaded?.status).toBe("queued");
    expect(loaded?.params.prompt).toBe("hello");
  });

  it("finds jobs by idempotency and active subject", async () => {
    await saveImageGenerationJob(baseJob({ status: "running" }));
    const byIdempotency = await findImageJobByIdempotencyKey({
      projectId: "project_1",
      scope: "management",
      idempotencyKey: "idem_1",
    });
    expect(byIdempotency?.id).toBe("img_test123");

    const active = await findActiveImageJobForSubject({
      projectId: "project_1",
      scope: "management",
      subjectKind: "design_item",
      subjectId: "item_1",
    });
    expect(active?.status).toBe("running");
  });
});
