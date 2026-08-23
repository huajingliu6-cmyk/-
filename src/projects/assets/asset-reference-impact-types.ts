export type LibraryAssetKind = "character" | "scene" | "prop";

export type AssetReferenceSample = {
  episodeId: string;
  episodeNumber: number;
  sceneId: string | null;
  sceneNumber: number | null;
  sceneTitle: string | null;
  shotId: string | null;
  shotNumber: number | null;
  fields: string[];
};

export type AssetReferenceImpact = {
  projectId: string;
  scope: "management" | "workspace";
  kind: LibraryAssetKind;
  assetId: string;
  referencedEpisodeCount: number;
  referencedSceneCount: number;
  referencedShotCount: number;
  /** True when any storyboard / match / requirement field still points at this asset. */
  inUse: boolean;
  samples: AssetReferenceSample[];
};
