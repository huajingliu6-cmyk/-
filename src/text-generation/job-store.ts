import { promises as fs } from "fs";
import path from "path";
import type { TextGenerationJob } from "@/text-generation/types";
import { projectRootDir } from "@/projects/project-storage";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  findJobByIdempotencyRemote,
  findRunningTextJobRemote,
  getTextJobRemote,
  listTextJobsRemote,
  saveTextJobRemote,
} from "@/text-generation/remote-job-store";

function jobsDir(projectId: string): string {
  return path.join(projectRootDir(projectId), "text-generations");
}

function jobPath(projectId: string, generationId: string): string {
  return path.join(jobsDir(projectId), `${generationId}.json`);
}

async function ensure(projectId: string) {
  await fs.mkdir(jobsDir(projectId), { recursive: true });
}

export async function saveTextJob(job: TextGenerationJob): Promise<void> {
  if (isRemoteDataOnly()) return saveTextJobRemote(job);
  await ensure(job.projectId);
  const target = jobPath(job.projectId, job.generationId);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(job, null, 2), "utf-8");
  await fs.rename(temp, target);
}

export async function getTextJob(
  projectId: string,
  generationId: string,
): Promise<TextGenerationJob | null> {
  if (isRemoteDataOnly()) return getTextJobRemote(projectId, generationId);
  try {
    const raw = await fs.readFile(jobPath(projectId, generationId), "utf-8");
    return JSON.parse(raw) as TextGenerationJob;
  } catch {
    return null;
  }
}

export async function findRunningTextJob(
  projectId: string,
  userId: string,
): Promise<TextGenerationJob | null> {
  if (isRemoteDataOnly()) return findRunningTextJobRemote(projectId, userId);
  await ensure(projectId);
  const entries = await fs.readdir(jobsDir(projectId)).catch(() => []);
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(
        path.join(jobsDir(projectId), name),
        "utf-8",
      );
      const job = JSON.parse(raw) as TextGenerationJob;
      if (
        job.userId === userId &&
        (job.status === "queued" || job.status === "running")
      ) {
        return job;
      }
    } catch {
      // skip
    }
  }
  return null;
}

export async function findJobByIdempotency(
  projectId: string,
  userId: string,
  idempotencyKey: string,
): Promise<TextGenerationJob | null> {
  if (isRemoteDataOnly()) {
    return findJobByIdempotencyRemote(projectId, userId, idempotencyKey);
  }
  await ensure(projectId);
  const entries = await fs.readdir(jobsDir(projectId)).catch(() => []);
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(
        path.join(jobsDir(projectId), name),
        "utf-8",
      );
      const job = JSON.parse(raw) as TextGenerationJob;
      if (job.userId === userId && job.idempotencyKey === idempotencyKey) {
        return job;
      }
    } catch {
      // skip
    }
  }
  return null;
}

export async function listTextJobs(
  projectId: string,
): Promise<TextGenerationJob[]> {
  if (isRemoteDataOnly()) return listTextJobsRemote(projectId);
  await ensure(projectId);
  const entries = await fs.readdir(jobsDir(projectId)).catch(() => []);
  const jobs: TextGenerationJob[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(jobsDir(projectId), name), "utf-8");
      const job = JSON.parse(raw) as TextGenerationJob;
      if (job && typeof job.generationId === "string") jobs.push(job);
    } catch {
      // skip
    }
  }
  return jobs;
}
