import "server-only";
import type { AssetApprovalsFile } from "@/projects/assets/approvals/types";
import { loadProjectAssetData, saveProjectAssetData } from "@/projects/assets/remote-project-asset-data";
export async function loadAssetApprovalsRemoteValue(projectId: string): Promise<unknown | null> { return (await loadProjectAssetData("approvals", projectId)).value; }
export async function loadAssetApprovalsRemoteDocument(projectId: string) { const result = await loadProjectAssetData("approvals", projectId); return result.value === null ? null : { value: result.value, revision: result.revision }; }
export function assetApprovalsRemoteIdentity(projectId: string) { return { namespace: "asset-approvals", key: projectId }; }
export function saveAssetApprovalsRemote(projectId: string, file: AssetApprovalsFile): Promise<AssetApprovalsFile> { return saveProjectAssetData("approvals", projectId, file); }