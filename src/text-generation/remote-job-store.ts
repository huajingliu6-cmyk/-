import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import type { TextGenerationJob } from "@/text-generation/types";

async function textJobRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await requestRemoteData(path, init);
  if (!response.ok) {
    throw new Error(`REMOTE_TEXT_JOB_REQUEST_FAILED:${response.status}`);
  }
  return (await response.json()) as T;
}

export async function listTextJobsRemote(
  projectId: string,
): Promise<TextGenerationJob[]> {
  const result = await textJobRequest<{ jobs: TextGenerationJob[] }>(
    `/v1/text-generation-jobs?projectId=${encodeURIComponent(projectId)}`,
  );
  return result.jobs;
}

export async function saveTextJobRemote(job: TextGenerationJob): Promise<void> {
  await textJobRequest("/v1/text-generation-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(job),
  });
}

export async function getTextJobRemote(
  projectId: string,
  generationId: string,
): Promise<TextGenerationJob | null> {
  const result = await textJobRequest<{ job: TextGenerationJob | null }>(
    `/v1/text-generation-jobs?projectId=${encodeURIComponent(projectId)}&generationId=${encodeURIComponent(generationId)}`,
  );
  return result.job;
}

export async function findRunningTextJobRemote(
  projectId: string,
  userId: string,
): Promise<TextGenerationJob | null> {
  const result = await textJobRequest<{ job: TextGenerationJob | null }>(
    `/v1/text-generation-jobs?projectId=${encodeURIComponent(projectId)}&userId=${encodeURIComponent(userId)}&running=true`,
  );
  return result.job;
}

export async function findJobByIdempotencyRemote(
  projectId: string,
  userId: string,
  idempotencyKey: string,
): Promise<TextGenerationJob | null> {
  const result = await textJobRequest<{ job: TextGenerationJob | null }>(
    `/v1/text-generation-jobs?projectId=${encodeURIComponent(projectId)}&userId=${encodeURIComponent(userId)}&idempotencyKey=${encodeURIComponent(idempotencyKey)}`,
  );
  return result.job;
}