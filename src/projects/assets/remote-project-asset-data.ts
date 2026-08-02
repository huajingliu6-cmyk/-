import "server-only";
import { requestRemoteData } from "@/persistence/remote-data-client";
export type ProjectAssetDataKind = "bundle" | "episode-designs" | "approvals";
export async function loadProjectAssetData(kind: ProjectAssetDataKind, projectId: string) {
  const response = await requestRemoteData(`/v1/project-asset-data?kind=${encodeURIComponent(kind)}&projectId=${encodeURIComponent(projectId)}`);
  if (!response.ok) throw new Error(`REMOTE_PROJECT_ASSET_DATA_REQUEST_FAILED:${response.status}`);
  return (await response.json()) as { value: unknown | null; revision: number };
}
export async function saveProjectAssetData<T>(kind: ProjectAssetDataKind, projectId: string, value: T): Promise<T> {
  const response = await requestRemoteData(`/v1/project-asset-data?kind=${encodeURIComponent(kind)}&projectId=${encodeURIComponent(projectId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) });
  if (!response.ok) throw new Error(`REMOTE_PROJECT_ASSET_DATA_REQUEST_FAILED:${response.status}`);
  return ((await response.json()) as { value: T }).value;
}