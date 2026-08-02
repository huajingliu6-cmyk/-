import "server-only";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { loadProjectAssetData, saveProjectAssetData } from "@/projects/assets/remote-project-asset-data";
export async function loadAssetBundleDraftRemoteValue(projectId: string): Promise<unknown | null> { return (await loadProjectAssetData("bundle", projectId)).value; }
export async function loadAssetBundleDraftRemoteDocument(projectId: string) { const result = await loadProjectAssetData("bundle", projectId); return result.value === null ? null : { value: result.value, revision: result.revision }; }
export function assetBundleRemoteIdentity(projectId: string) { return { namespace: "asset-bundles", key: projectId }; }
export function saveAssetBundleDraftRemote(draft: AssetBundleDraft): Promise<AssetBundleDraft> { return saveProjectAssetData("bundle", draft.projectId, draft); }