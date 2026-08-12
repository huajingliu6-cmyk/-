import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import {
  ProjectNameConflictError,
  ProjectNotFoundError,
} from "@/projects/project-errors";
import type {
  CreateProjectInput,
  ProjectPublic,
  ProjectRecord,
} from "@/projects/types";
import type { WorkflowProjectSummary } from "@/workflow/lib/workflow-storage";

type ProjectListResponse = {
  projects: ProjectRecord[];
  revision: number;
};

type ProjectResponse<T> = {
  project: T;
};

async function projectRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const response = await requestRemoteData(path, init);
  if (response.status === 404) return null;
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { code?: string }
      | null;
    if (response.status === 409 && payload?.code === "PROJECT_NAME_CONFLICT") {
      throw new ProjectNameConflictError();
    }
    throw new Error(`REMOTE_PROJECT_REQUEST_FAILED:${response.status}`);
  }
  return (await response.json()) as T;
}

export async function listProjectRecordsRemote(): Promise<ProjectRecord[]> {
  const result = await projectRequest<ProjectListResponse>("/v1/projects");
  return [...(result?.projects ?? [])].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export async function listProjectSummariesRemote(): Promise<
  WorkflowProjectSummary[]
> {
  const result = await projectRequest<ProjectListResponse>("/v1/projects");
  const revision = result?.revision ?? 0;
  return [...(result?.projects ?? [])]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((project) => ({
      projectId: project.projectId,
      name: project.name,
      updatedAt: project.updatedAt,
      revision,
      nodeCount: 0,
      videoShotCount: 0,
      status: "draft",
      generationProgress: null,
    }));
}

export async function getProjectRecordRemote(
  projectId: string,
): Promise<ProjectRecord | null> {
  const result = await projectRequest<ProjectResponse<ProjectRecord>>(
    `/v1/projects/${encodeURIComponent(projectId)}`,
  );
  return result?.project ?? null;
}

export async function getProjectPublicRemote(
  projectId: string,
): Promise<ProjectPublic | null> {
  const record = await getProjectRecordRemote(projectId);
  if (!record) return null;
  return {
    projectId: record.projectId,
    rootFolderId: record.rootFolderId,
    name: record.name,
    ownerId: record.ownerId,
    creationSource: record.creationSource,
    projectMode: record.projectMode,
    status: record.status,
    highlights: record.highlights,
    passwordEnabled: record.passwordEnabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function findProjectByIdempotencyRemote(
  ownerId: string,
  idempotencyKey: string,
): Promise<ProjectPublic | null> {
  const result = await projectRequest<ProjectResponse<ProjectPublic>>(
    `/v1/projects/by-idempotency/${encodeURIComponent(idempotencyKey)}`,
    { headers: { "x-actor-id": ownerId } },
  );
  return result?.project ?? null;
}

export async function createProjectRecordRemote(
  ownerId: string,
  input: CreateProjectInput,
): Promise<ProjectPublic> {
  const result = await projectRequest<ProjectResponse<ProjectPublic>>(
    "/v1/projects",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-actor-id": ownerId,
      },
      body: JSON.stringify(input),
    },
  );
  if (!result) throw new Error("REMOTE_PROJECT_CREATE_EMPTY");
  return result.project;
}

export async function updateProjectHighlightsRemote(
  projectId: string,
  highlights: string,
): Promise<ProjectPublic> {
  const result = await projectRequest<ProjectResponse<ProjectPublic>>(
    `/v1/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ highlights }),
    },
  );
  if (!result) throw new ProjectNotFoundError();
  return result.project;
}

export async function updateProjectNameRemote(
  projectId: string,
  name: string,
): Promise<ProjectPublic> {
  const result = await projectRequest<ProjectResponse<ProjectPublic>>(
    `/v1/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  if (!result) throw new ProjectNotFoundError();
  return result.project;
}

export async function updateProjectOwnerIdRemote(
  projectId: string,
  ownerId: string,
): Promise<ProjectPublic> {
  const result = await projectRequest<ProjectResponse<ProjectPublic>>(
    `/v1/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId }),
    },
  );
  if (!result) throw new ProjectNotFoundError();
  return result.project;
}

export async function deleteProjectRecordRemote(
  projectId: string,
): Promise<void> {
  const response = await requestRemoteData(
    `/v1/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  );
  if (response.status === 404) throw new ProjectNotFoundError();
  if (!response.ok) {
    throw new Error(`REMOTE_PROJECT_REQUEST_FAILED:${response.status}`);
  }
}