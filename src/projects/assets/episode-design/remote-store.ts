import "server-only";
import type { ProjectEpisodeAssetDesignStore } from "@/projects/assets/episode-design/types";
import { loadProjectAssetData, saveProjectAssetData } from "@/projects/assets/remote-project-asset-data";
export async function loadEpisodeAssetDesignStoreRemoteValue(projectId: string): Promise<unknown | null> { return (await loadProjectAssetData("episode-designs", projectId)).value; }
export async function loadEpisodeAssetDesignStoreRemoteDocument(projectId: string) { const result = await loadProjectAssetData("episode-designs", projectId); return result.value === null ? null : { value: result.value, revision: result.revision }; }
export function episodeAssetDesignRemoteIdentity(projectId: string) { return { namespace: "episode-asset-designs", key: projectId }; }
export function saveEpisodeAssetDesignStoreRemote(store: ProjectEpisodeAssetDesignStore): Promise<ProjectEpisodeAssetDesignStore> { return saveProjectAssetData("episode-designs", store.projectId, store); }