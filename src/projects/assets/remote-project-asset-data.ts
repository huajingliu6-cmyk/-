import "server-only";
import { requestRemoteData } from "@/persistence/remote-data-client";

export type ProjectAssetDataKind = "bundle" | "episode-designs" | "approvals";

export const REMOTE_PROJECT_ASSET_DATA_CONFLICT =
  "REMOTE_PROJECT_ASSET_DATA_CONFLICT";

export function isRemoteProjectAssetDataConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith(REMOTE_PROJECT_ASSET_DATA_CONFLICT)
  );
}

export async function loadProjectAssetData(
  kind: ProjectAssetDataKind,
  projectId: string,
) {
  const response = await requestRemoteData(
    `/v1/project-asset-data?kind=${encodeURIComponent(kind)}&projectId=${encodeURIComponent(projectId)}`,
  );
  if (!response.ok) {
    throw new Error(`REMOTE_PROJECT_ASSET_DATA_REQUEST_FAILED:${response.status}`);
  }
  return (await response.json()) as { value: unknown | null; revision: number };
}

export async function saveProjectAssetData<T>(
  kind: ProjectAssetDataKind,
  projectId: string,
  value: T,
): Promise<T> {
  const current = await loadProjectAssetData(kind, projectId);
  const response = await requestRemoteData(
    `/v1/project-asset-data?kind=${encodeURIComponent(kind)}&projectId=${encodeURIComponent(projectId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        value,
        expectedRevision: current.revision,
      }),
    },
  );
  if (response.status === 409) {
    throw new Error(REMOTE_PROJECT_ASSET_DATA_CONFLICT);
  }
  if (!response.ok) {
    throw new Error(`REMOTE_PROJECT_ASSET_DATA_REQUEST_FAILED:${response.status}`);
  }
  return ((await response.json()) as { value: T }).value;
}

/** Reload-and-rebuild until CAS write succeeds. */
export async function saveProjectAssetDataWithRetry<T>(
  kind: ProjectAssetDataKind,
  projectId: string,
  build: (currentValue: T | null, revision: number) => T,
  attempts = 6,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await loadProjectAssetData(kind, projectId);
    const next = build((current.value as T | null) ?? null, current.revision);
    try {
      const response = await requestRemoteData(
        `/v1/project-asset-data?kind=${encodeURIComponent(kind)}&projectId=${encodeURIComponent(projectId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            value: next,
            expectedRevision: current.revision,
          }),
        },
      );
      if (response.status === 409) {
        lastError = new Error(REMOTE_PROJECT_ASSET_DATA_CONFLICT);
        continue;
      }
      if (!response.ok) {
        throw new Error(
          `REMOTE_PROJECT_ASSET_DATA_REQUEST_FAILED:${response.status}`,
        );
      }
      return ((await response.json()) as { value: T }).value;
    } catch (error) {
      if (isRemoteProjectAssetDataConflict(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(REMOTE_PROJECT_ASSET_DATA_CONFLICT);
}
