import "server-only";

import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import type {
  CreateProjectInput,
  ProjectPublic,
  ProjectRecord,
} from "@/projects/types";
import type { WorkflowProjectSummary } from "@/workflow/lib/workflow-storage";
import {
  createProjectRecord as createProjectRecordLocal,
  getProjectNameMap as getProjectNameMapLocal,
  getProjectPublic as getProjectPublicLocal,
  getProjectRecord as getProjectRecordLocal,
  listProjectRecords as listProjectRecordsLocal,
  updateProjectHighlights as updateProjectHighlightsLocal,
  updateProjectName as updateProjectNameLocal,
  deleteProjectRecord as deleteProjectRecordLocal,
} from "@/projects/project-storage";
import {
  createProjectRecordRemote,
  findProjectByIdempotencyRemote,
  getProjectPublicRemote,
  getProjectRecordRemote,
  listProjectRecordsRemote,
  listProjectSummariesRemote,
  updateProjectHighlightsRemote,
  updateProjectNameRemote,
  deleteProjectRecordRemote,
} from "@/projects/remote-project-store";

export {
  ProjectNameConflictError,
  ProjectNotFoundError,
} from "@/projects/project-errors";

export function listProjectRecords(): Promise<ProjectRecord[]> {
  return isRemoteDataOnly()
    ? listProjectRecordsRemote()
    : listProjectRecordsLocal();
}

export function getProjectRecord(
  projectId: string,
): Promise<ProjectRecord | null> {
  return isRemoteDataOnly()
    ? getProjectRecordRemote(projectId)
    : getProjectRecordLocal(projectId);
}

export function getProjectPublic(
  projectId: string,
): Promise<ProjectPublic | null> {
  return isRemoteDataOnly()
    ? getProjectPublicRemote(projectId)
    : getProjectPublicLocal(projectId);
}

export function createProjectRecord(
  ownerId: string,
  input: CreateProjectInput,
): Promise<ProjectPublic> {
  return isRemoteDataOnly()
    ? createProjectRecordRemote(ownerId, input)
    : createProjectRecordLocal(ownerId, input);
}

export function findProjectByCreateIdempotency(
  ownerId: string,
  idempotencyKey: string,
): Promise<ProjectPublic | null> {
  return isRemoteDataOnly()
    ? findProjectByIdempotencyRemote(ownerId, idempotencyKey)
    : Promise.resolve(null);
}

export function updateProjectHighlights(
  projectId: string,
  highlights: string,
): Promise<ProjectPublic> {
  return isRemoteDataOnly()
    ? updateProjectHighlightsRemote(projectId, highlights)
    : updateProjectHighlightsLocal(projectId, highlights);
}

export function updateProjectName(
  projectId: string,
  name: string,
): Promise<ProjectPublic> {
  return isRemoteDataOnly()
    ? updateProjectNameRemote(projectId, name)
    : updateProjectNameLocal(projectId, name);
}

export function deleteProjectRecord(projectId: string): Promise<void> {
  return isRemoteDataOnly()
    ? deleteProjectRecordRemote(projectId)
    : deleteProjectRecordLocal(projectId);
}

export async function getProjectNameMap(): Promise<Map<string, string>> {
  if (!isRemoteDataOnly()) return getProjectNameMapLocal();
  const records = await listProjectRecordsRemote();
  return new Map(records.map((record) => [record.projectId, record.name]));
}

export async function listProjectListItems(): Promise<{
  projects: WorkflowProjectSummary[];
}> {
  if (isRemoteDataOnly()) {
    return { projects: await listProjectSummariesRemote() };
  }
  const projects = (await listProjectRecordsLocal())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((project) => ({
      projectId: project.projectId,
      name: project.name,
      updatedAt: project.updatedAt,
      revision: 0,
      nodeCount: 0,
      videoShotCount: 0,
      status: "draft" as const,
      generationProgress: null,
    }));
  return { projects };
}
