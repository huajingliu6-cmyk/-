import "server-only";

import type { AssetBundleStoreScope } from "@/projects/assets/asset-bundle-scope";
import {
  type AssetReferenceImpact,
  type AssetReferenceSample,
  type LibraryAssetKind,
} from "@/projects/assets/asset-reference-impact-types";
import { loadWorkspace } from "@/projects/storyboard/production-store";
import type {
  AssetKind,
  AssetMatchItem,
  EpisodeProduction,
  ProjectStoryboardWorkspace,
  ShotAssetRequirement,
  StoryboardScene,
  StoryboardShot,
} from "@/projects/storyboard/types";

export type {
  AssetReferenceImpact,
  AssetReferenceSample,
  LibraryAssetKind,
} from "@/projects/assets/asset-reference-impact-types";

function isLibraryAssetKind(value: string): value is LibraryAssetKind {
  return value === "character" || value === "scene" || value === "prop";
}

export function parseLibraryAssetKind(
  value: string,
): LibraryAssetKind | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "characters") return "character";
  if (trimmed === "scenes") return "scene";
  if (trimmed === "props") return "prop";
  if (isLibraryAssetKind(trimmed)) return trimmed;
  return null;
}

function pushUnique(target: string[], value: string) {
  if (!target.includes(value)) target.push(value);
}

function matchAssetType(
  kind: LibraryAssetKind,
  assetType: AssetKind,
): boolean {
  return assetType === kind;
}

function requirementTypeMatches(
  kind: LibraryAssetKind,
  type: ShotAssetRequirement["type"],
): boolean {
  return type === kind;
}

function collectShotFields(
  kind: LibraryAssetKind,
  assetId: string,
  shot: StoryboardShot,
): string[] {
  const fields: string[] = [];
  if (kind === "character") {
    if (shot.characterAssetIds.includes(assetId)) {
      pushUnique(fields, "characterAssetIds");
    }
    if (shot.assetMediaIds && assetId in shot.assetMediaIds) {
      pushUnique(fields, "assetMediaIds");
    }
    if (
      shot.sceneCharacterPlacements?.some(
        (placement) => placement.characterAssetId === assetId,
      )
    ) {
      pushUnique(fields, "sceneCharacterPlacements");
    }
  }
  if (kind === "scene") {
    if (shot.sceneAssetId === assetId) pushUnique(fields, "sceneAssetId");
    if (shot.sceneAssetIds.includes(assetId)) {
      pushUnique(fields, "sceneAssetIds");
    }
    if (shot.assetMediaIds && assetId in shot.assetMediaIds) {
      pushUnique(fields, "assetMediaIds");
    }
  }
  if (kind === "prop") {
    if (shot.propAssetIds.includes(assetId)) pushUnique(fields, "propAssetIds");
    if (shot.assetMediaIds && assetId in shot.assetMediaIds) {
      pushUnique(fields, "assetMediaIds");
    }
  }
  for (const requirement of shot.requirements ?? []) {
    if (
      requirementTypeMatches(kind, requirement.type) &&
      requirement.selectedAssetId === assetId
    ) {
      pushUnique(fields, "requirements");
      break;
    }
  }
  return fields;
}

function collectSceneFields(
  kind: LibraryAssetKind,
  assetId: string,
  scene: StoryboardScene,
): string[] {
  const fields: string[] = [];
  if (kind === "character" && scene.characterAssetIds.includes(assetId)) {
    pushUnique(fields, "characterAssetIds");
  }
  if (kind === "scene" && scene.sceneAssetIds.includes(assetId)) {
    pushUnique(fields, "sceneAssetIds");
  }
  if (kind === "prop" && scene.propAssetIds.includes(assetId)) {
    pushUnique(fields, "propAssetIds");
  }
  return fields;
}

function collectMatchFields(
  kind: LibraryAssetKind,
  assetId: string,
  matches: AssetMatchItem[],
): string[] {
  const hit = matches.some(
    (match) =>
      matchAssetType(kind, match.assetType) && match.matchedAssetId === assetId,
  );
  return hit ? ["assetMatches"] : [];
}

/**
 * Read-only analysis of storyboard-production references to a library asset.
 * Does not write any data.
 */
export async function analyzeAssetReferenceImpact(params: {
  projectId: string;
  scope: AssetBundleStoreScope;
  kind: LibraryAssetKind;
  assetId: string;
  /** Optional preloaded workspace to avoid double reads during delete. */
  workspace?: ProjectStoryboardWorkspace | null;
}): Promise<AssetReferenceImpact> {
  const assetId = params.assetId.trim();
  const workspace =
    params.workspace === undefined
      ? await loadWorkspace(params.projectId)
      : params.workspace;

  const episodeIds = new Set<string>();
  const sceneIds = new Set<string>();
  const shotIds = new Set<string>();
  const samples: AssetReferenceSample[] = [];

  const pushSample = (sample: AssetReferenceSample) => {
    if (sample.fields.length === 0) return;
    if (samples.length < 12) samples.push(sample);
  };

  for (const production of workspace?.productions ?? []) {
    const matchFields = collectMatchFields(
      params.kind,
      assetId,
      production.assetMatches ?? [],
    );
    if (matchFields.length > 0) {
      episodeIds.add(production.episodeId);
      pushSample({
        episodeId: production.episodeId,
        episodeNumber: production.episodeNumber,
        sceneId: null,
        sceneNumber: null,
        sceneTitle: null,
        shotId: null,
        shotNumber: null,
        fields: matchFields,
      });
    }

    const storyboard = production.activeStoryboard;
    if (!storyboard) continue;

    for (const scene of storyboard.scenes) {
      const sceneFields = collectSceneFields(params.kind, assetId, scene);
      if (sceneFields.length > 0) {
        episodeIds.add(production.episodeId);
        sceneIds.add(scene.id);
        pushSample({
          episodeId: production.episodeId,
          episodeNumber: production.episodeNumber,
          sceneId: scene.id,
          sceneNumber: scene.sceneNumber,
          sceneTitle: scene.title,
          shotId: null,
          shotNumber: null,
          fields: sceneFields,
        });
      }

      for (const shot of scene.shots) {
        const shotFields = collectShotFields(params.kind, assetId, shot);
        if (shotFields.length === 0) continue;
        episodeIds.add(production.episodeId);
        sceneIds.add(scene.id);
        shotIds.add(shot.id);
        pushSample({
          episodeId: production.episodeId,
          episodeNumber: production.episodeNumber,
          sceneId: scene.id,
          sceneNumber: scene.sceneNumber,
          sceneTitle: scene.title,
          shotId: shot.id,
          shotNumber: shot.shotNumber,
          fields: shotFields,
        });
      }
    }
  }

  const referencedShotCount = shotIds.size;
  const referencedSceneCount = sceneIds.size;
  const referencedEpisodeCount = episodeIds.size;
  const inUse =
    referencedShotCount > 0 ||
    referencedSceneCount > 0 ||
    samples.length > 0;

  return {
    projectId: params.projectId,
    scope: params.scope,
    kind: params.kind,
    assetId,
    referencedEpisodeCount,
    referencedSceneCount,
    referencedShotCount,
    inUse,
    samples,
  };
}

export function formatAssetInUseMessage(impact: AssetReferenceImpact): string {
  const shotCount = impact.referencedShotCount;
  if (shotCount > 0) {
    return `该资产正在被 ${shotCount} 个镜头使用，无法直接删除。可先解除分镜关联后再删除。`;
  }
  if (impact.referencedSceneCount > 0) {
    return `该资产仍被 ${impact.referencedSceneCount} 个分镜场景引用，无法直接删除。可先解除关联后再删除。`;
  }
  return "该资产仍被分镜引用，无法直接删除。可先解除关联后再删除。";
}

export type { EpisodeProduction };
