import type { ProjectAssetBundle } from "@/projects/assets/types";
import type { ProjectEpisodeAssetDesignStore } from "@/projects/assets/episode-design/types";

export type WorkspaceSnapshotEpisode = {
  id: string;
  episodeNumber: number;
  title: string;
  content: string;
};

export type WorkspaceSnapshot = {
  projectId: string;
  upstreamRevision: number;
  syncedAt: string;
  sourceFingerprint: string | null;
  /** Confirmed formal episodes only (copy from management script.json episodes) */
  episodes: WorkspaceSnapshotEpisode[];
  /** Snapshot of management assets bundle (characters/scenes/props/audio metadata) */
  assets: ProjectAssetBundle;
  /** Snapshot of management episode-asset-designs store */
  episodeAssetDesigns: ProjectEpisodeAssetDesignStore;
  syncStatus: "ok" | "failed";
  syncError: string | null;
};

export type WorkspaceLocalStore = {
  projectId: string;
  episodeAssetDesigns: ProjectEpisodeAssetDesignStore;
  assets: ProjectAssetBundle & { updatedAt: string };
  overrides: Record<string, unknown>;
  updatedAt: string;
};
