import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import type { ImageGenerationJob } from "@/projects/assets/image-generation/types";

async function imageJobRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await requestRemoteData(path, init);
  if (!response.ok) {
    throw new Error(`REMOTE_IMAGE_JOB_REQUEST_FAILED:${response.status}`);
  }
  return (await response.json()) as T;
}

export async function saveImageGenerationJobRemote(
  job: ImageGenerationJob,
): Promise<void> {
  await imageJobRequest("/v1/image-generation-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(job),
  });
}

export async function readImageGenerationJobRemote(
  id: string,
): Promise<ImageGenerationJob | null> {
  const result = await imageJobRequest<{ job: ImageGenerationJob | null }>(
    `/v1/image-generation-jobs?id=${encodeURIComponent(id)}`,
  );
  return result.job;
}

export async function listImageGenerationJobsRemote(input: {
  projectId: string;
  scope?: "management" | "workspace";
  subjectId?: string;
}): Promise<ImageGenerationJob[]> {
  const params = new URLSearchParams({ projectId: input.projectId });
  if (input.scope) params.set("scope", input.scope);
  if (input.subjectId) params.set("subjectId", input.subjectId);
  const result = await imageJobRequest<{ jobs: ImageGenerationJob[] }>(
    `/v1/image-generation-jobs?${params.toString()}`,
  );
  return result.jobs ?? [];
}

export async function findImageJobByIdempotencyKeyRemote(input: {
  projectId: string;
  scope: "management" | "workspace";
  idempotencyKey: string;
}): Promise<ImageGenerationJob | null> {
  const params = new URLSearchParams({
    projectId: input.projectId,
    scope: input.scope,
    idempotencyKey: input.idempotencyKey,
  });
  const result = await imageJobRequest<{ job: ImageGenerationJob | null }>(
    `/v1/image-generation-jobs?${params.toString()}`,
  );
  return result.job;
}

export async function findActiveImageJobForSubjectRemote(input: {
  projectId: string;
  scope: "management" | "workspace";
  subjectKind: ImageGenerationJob["subjectKind"];
  subjectId: string;
}): Promise<ImageGenerationJob | null> {
  const params = new URLSearchParams({
    projectId: input.projectId,
    scope: input.scope,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    active: "true",
  });
  const result = await imageJobRequest<{ job: ImageGenerationJob | null }>(
    `/v1/image-generation-jobs?${params.toString()}`,
  );
  return result.job;
}
