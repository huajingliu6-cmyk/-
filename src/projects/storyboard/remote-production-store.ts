import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import type { ProjectStoryboardWorkspace } from "@/projects/storyboard/types";

const ENDPOINT = "/v1/storyboard-productions";
const REMOTE_REVISION = Symbol("storyboard-production-remote-revision");

type WorkspaceWithRemoteRevision = ProjectStoryboardWorkspace & {
  [REMOTE_REVISION]?: number;
};

export function attachStoryboardRemoteRevision(
  workspace: ProjectStoryboardWorkspace,
  revision: number,
): ProjectStoryboardWorkspace {
  Object.defineProperty(workspace, REMOTE_REVISION, {
    value: revision,
    configurable: true,
    enumerable: true,
    writable: true,
  });
  return workspace;
}

export function carryStoryboardRemoteRevision(
  source: ProjectStoryboardWorkspace | null,
  target: ProjectStoryboardWorkspace,
): ProjectStoryboardWorkspace {
  const revision = source
    ? (source as WorkspaceWithRemoteRevision)[REMOTE_REVISION]
    : undefined;
  return typeof revision === "number"
    ? attachStoryboardRemoteRevision(target, revision)
    : target;
}

export function storyboardRemoteRevision(
  workspace: ProjectStoryboardWorkspace,
): number | null {
  const revision = (workspace as WorkspaceWithRemoteRevision)[REMOTE_REVISION];
  return typeof revision === "number" ? revision : null;
}

async function storyboardRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await requestRemoteData(path, init);
  if (response.status === 409) throw new Error("REVISION_CONFLICT");
  if (!response.ok) {
    throw new Error(`REMOTE_STORYBOARD_PRODUCTION_REQUEST_FAILED:${response.status}`);
  }
  return (await response.json()) as T;
}

export async function loadStoryboardWorkspaceRemoteDocument(projectId: string) {
  const result = await storyboardRequest<{
    workspace: unknown | null;
    revision: number;
  }>(`${ENDPOINT}?projectId=${encodeURIComponent(projectId)}`);
  return result.workspace === null
    ? null
    : { value: result.workspace, revision: result.revision };
}

export async function saveStoryboardWorkspaceRemote(
  workspace: ProjectStoryboardWorkspace,
): Promise<ProjectStoryboardWorkspace> {
  const carriedRevision = storyboardRemoteRevision(workspace);
  const current =
    carriedRevision === null
      ? await loadStoryboardWorkspaceRemoteDocument(workspace.projectId)
      : null;
  const expectedRevision = carriedRevision ?? current?.revision ?? 0;
  const result = await storyboardRequest<{
    workspace: ProjectStoryboardWorkspace;
    revision: number;
  }>(`${ENDPOINT}?projectId=${encodeURIComponent(workspace.projectId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision, workspace }),
  });
  return attachStoryboardRemoteRevision(result.workspace, result.revision);
}