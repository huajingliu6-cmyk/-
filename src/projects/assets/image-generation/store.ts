import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  findActiveImageJobForSubjectRemote,
  findImageJobByIdempotencyKeyRemote,
  listImageGenerationJobsRemote,
  readImageGenerationJobRemote,
  saveImageGenerationJobRemote,
} from "@/projects/assets/image-generation/remote-job-store";
import {
  IMAGE_JOB_ACTIVE_STATUSES,
  isImageGenerationJob,
  subjectKey,
  type ImageGenerationJob,
  type ImageGenerationJobStatus,
} from "@/projects/assets/image-generation/types";

type StoreGlobal = typeof globalThis & {
  __infiniteCanvasGenerationStoreRoot?: string;
};

function getGenerationsDir(): string {
  const g = globalThis as StoreGlobal;
  return g.__infiniteCanvasGenerationStoreRoot ?? resolveAppDataPath("generations");
}

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

export function assertSafeImageJobId(id: string): string {
  if (!SAFE_ID.test(id) || id.includes("..") || !id.startsWith("img_")) {
    throw new Error("无效的 image job id");
  }
  return id;
}

export function createImageJobId(): string {
  return `img_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function ensureDir() {
  await fs.mkdir(getGenerationsDir(), { recursive: true });
}

function filePath(id: string): string {
  return path.join(getGenerationsDir(), `${assertSafeImageJobId(id)}.json`);
}

async function atomicWriteFile(target: string, contents: string): Promise<void> {
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, contents, "utf8");
  try {
    await fs.rename(tmp, target);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (code === "EPERM" || code === "EEXIST") {
      await fs.unlink(target).catch(() => undefined);
      await fs.rename(tmp, target);
      return;
    }
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export async function saveImageGenerationJob(
  job: ImageGenerationJob,
): Promise<void> {
  assertSafeImageJobId(job.id);
  if (isRemoteDataOnly()) {
    await saveImageGenerationJobRemote(job);
    return;
  }
  await ensureDir();
  await atomicWriteFile(filePath(job.id), JSON.stringify(job, null, 2));
}

export async function readImageGenerationJob(
  id: string,
): Promise<ImageGenerationJob | null> {
  assertSafeImageJobId(id);
  if (isRemoteDataOnly()) {
    const job = await readImageGenerationJobRemote(id);
    return job ? normalizeImageJob(job) : null;
  }
  try {
    const raw = await fs.readFile(filePath(id), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isImageGenerationJob(parsed)) return null;
    return normalizeImageJob(parsed);
  } catch {
    return null;
  }
}

function normalizeImageJob(job: ImageGenerationJob): ImageGenerationJob {
  return {
    ...job,
    workerInstanceId: job.workerInstanceId ?? null,
    leaseToken: job.leaseToken ?? null,
    heartbeatAt: job.heartbeatAt ?? null,
    providerTaskId: job.providerTaskId ?? null,
    resultClaimed: Boolean(job.resultClaimed),
    sourceEntry: job.sourceEntry ?? job.params?.retrySnapshot?.sourceEntry ?? "unknown",
    params: {
      ...job.params,
      retrySnapshot: job.params.retrySnapshot ?? null,
    },
  };
}


export async function updateImageGenerationJob(
  id: string,
  patch: Partial<ImageGenerationJob>,
): Promise<ImageGenerationJob> {
  const current = await readImageGenerationJob(id);
  if (!current) throw new Error("生成任务不存在");
  const next: ImageGenerationJob = {
    ...current,
    ...patch,
    id: current.id,
    recordType: "image",
    updatedAt: new Date().toISOString(),
  };
  await saveImageGenerationJob(next);
  return next;
}

export async function listImageGenerationJobs(filters?: {
  projectId?: string;
  scope?: "management" | "workspace";
  subjectId?: string;
}): Promise<ImageGenerationJob[]> {
  if (isRemoteDataOnly()) {
    if (!filters?.projectId) return [];
    const jobs = await listImageGenerationJobsRemote({
      projectId: filters.projectId,
      scope: filters.scope,
      subjectId: filters.subjectId,
    });
    return jobs.map(normalizeImageJob).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  await ensureDir();
  const names = await fs.readdir(getGenerationsDir());
  const out: ImageGenerationJob[] = [];
  for (const name of names) {
    if (!name.startsWith("img_") || !name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    const job = await readImageGenerationJob(id);
    if (!job) continue;
    if (filters?.projectId && job.projectId !== filters.projectId) continue;
    if (filters?.scope && job.scope !== filters.scope) continue;
    if (filters?.subjectId && job.subjectId !== filters.subjectId) continue;
    out.push(job);
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function findLatestImageJobForSubject(input: {
  projectId: string;
  scope: "management" | "workspace";
  subjectKind: ImageGenerationJob["subjectKind"];
  subjectId: string;
  sourceEntry?: ImageGenerationJob["sourceEntry"];
}): Promise<ImageGenerationJob | null> {
  const jobs = await listImageGenerationJobs({
    projectId: input.projectId,
    scope: input.scope,
    subjectId: input.subjectId,
  });
  const key = subjectKey(input);
  return (
    jobs.find(
      (job) =>
        job.subjectKind === input.subjectKind &&
        subjectKey(job) === key &&
        (!input.sourceEntry || job.sourceEntry === input.sourceEntry),
    ) ?? null
  );
}

export async function findActiveImageJobForSubject(input: {
  projectId: string;
  scope: "management" | "workspace";
  subjectKind: ImageGenerationJob["subjectKind"];
  subjectId: string;
}): Promise<ImageGenerationJob | null> {
  if (isRemoteDataOnly()) {
    const job = await findActiveImageJobForSubjectRemote(input);
    return job ? normalizeImageJob(job) : null;
  }
  const latest = await findLatestImageJobForSubject(input);
  if (!latest) return null;
  if (IMAGE_JOB_ACTIVE_STATUSES.includes(latest.status)) return latest;
  return null;
}

export async function findImageJobByIdempotencyKey(input: {
  projectId: string;
  scope: "management" | "workspace";
  idempotencyKey: string;
}): Promise<ImageGenerationJob | null> {
  const key = input.idempotencyKey.trim();
  if (!key) return null;
  if (isRemoteDataOnly()) {
    const job = await findImageJobByIdempotencyKeyRemote({
      projectId: input.projectId,
      scope: input.scope,
      idempotencyKey: key,
    });
    return job ? normalizeImageJob(job) : null;
  }
  const jobs = await listImageGenerationJobs({
    projectId: input.projectId,
    scope: input.scope,
  });
  return jobs.find((job) => job.idempotencyKey === key) ?? null;
}

export function isActiveImageJobStatus(
  status: ImageGenerationJobStatus,
): boolean {
  return IMAGE_JOB_ACTIVE_STATUSES.includes(status);
}
