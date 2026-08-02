import path from "path";
import { projectRootDir } from "@/projects/project-storage";

export function workspaceDir(projectId: string): string {
  return path.join(projectRootDir(projectId), "workspace");
}

export function workspaceSnapshotPath(projectId: string): string {
  return path.join(workspaceDir(projectId), "snapshot.json");
}

export function workspaceEpisodeAssetDesignsPath(projectId: string): string {
  return path.join(workspaceDir(projectId), "episode-asset-designs.json");
}

export function workspaceAssetsPath(projectId: string): string {
  return path.join(workspaceDir(projectId), "assets.json");
}

export function workspaceAssetImagesDir(projectId: string): string {
  return path.join(workspaceDir(projectId), "asset-images");
}

export function workspaceAssetAudioDir(projectId: string): string {
  return path.join(workspaceDir(projectId), "asset-audio");
}
