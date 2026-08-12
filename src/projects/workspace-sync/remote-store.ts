import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";

const ENDPOINT = "/v1/workspace-data";
type WorkspaceKind = "snapshot" | "assets" | "episode-designs";

async function requestWorkspaceData<T>(
  kind: WorkspaceKind,
  projectId: string,
  init: RequestInit = {},
): Promise<{ value: T | null; revision: number }> {
  const response = await requestRemoteData(
    `${ENDPOINT}?kind=${encodeURIComponent(kind)}&projectId=${encodeURIComponent(projectId)}`,
    init,
  );
  if (!response.ok) throw new Error(`REMOTE_WORKSPACE_REQUEST_FAILED:${response.status}`);
  return (await response.json()) as { value: T | null; revision: number };
}

function loadRemoteValue(kind: WorkspaceKind, projectId: string): Promise<unknown | null> {
  return requestWorkspaceData(kind, projectId).then((result) => result.value);
}

function loadRemoteDocument(kind: WorkspaceKind, projectId: string) {
  return requestWorkspaceData(kind, projectId).then((result) =>
    result.value === null ? null : { value: result.value, revision: result.revision },
  );
}

export const REMOTE_WORKSPACE_DATA_CONFLICT =
  "REMOTE_WORKSPACE_REQUEST_FAILED:409";

export function isRemoteWorkspaceDataConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === REMOTE_WORKSPACE_DATA_CONFLICT ||
      error.message.startsWith("REMOTE_WORKSPACE_REQUEST_FAILED:409"))
  );
}

async function saveRemoteValue<T>(
  kind: WorkspaceKind,
  projectId: string,
  value: T,
  expectedRevision?: number,
): Promise<T> {
  const revision =
    expectedRevision ?? (await requestWorkspaceData<T>(kind, projectId)).revision;
  const response = await requestRemoteData(
    `${ENDPOINT}?kind=${encodeURIComponent(kind)}&projectId=${encodeURIComponent(projectId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        value,
        expectedRevision: revision,
      }),
    },
  );
  if (response.status === 409) {
    throw new Error(REMOTE_WORKSPACE_DATA_CONFLICT);
  }
  if (!response.ok) {
    throw new Error(`REMOTE_WORKSPACE_REQUEST_FAILED:${response.status}`);
  }
  return ((await response.json()) as { value: T }).value;
}

export const loadWorkspaceSnapshotRemoteValue = (projectId: string) => loadRemoteValue("snapshot", projectId);
export const loadWorkspaceSnapshotRemoteDocument = (projectId: string) => loadRemoteDocument("snapshot", projectId);
export const workspaceSnapshotRemoteIdentity = (projectId: string) => ({ namespace: "workspace-snapshots", key: projectId });
export const saveWorkspaceSnapshotRemote = <T>(projectId: string, value: T) => saveRemoteValue("snapshot", projectId, value);
export const loadWorkspaceAssetsRemoteValue = (projectId: string) => loadRemoteValue("assets", projectId);
export const loadWorkspaceAssetsRemoteDocument = (projectId: string) => loadRemoteDocument("assets", projectId);
export const workspaceAssetsRemoteIdentity = (projectId: string) => ({ namespace: "workspace-assets", key: projectId });
export const saveWorkspaceAssetsRemote = <T>(projectId: string, value: T) => saveRemoteValue("assets", projectId, value);
export const loadWorkspaceEpisodeDesignsRemoteValue = (projectId: string) => loadRemoteValue("episode-designs", projectId);
export const loadWorkspaceEpisodeDesignsRemoteDocument = (projectId: string) => loadRemoteDocument("episode-designs", projectId);
export const workspaceEpisodeDesignsRemoteIdentity = (projectId: string) => ({ namespace: "workspace-episode-asset-designs", key: projectId });
export const saveWorkspaceEpisodeDesignsRemote = <T>(
  projectId: string,
  value: T,
  expectedRevision?: number,
) => saveRemoteValue("episode-designs", projectId, value, expectedRevision);
