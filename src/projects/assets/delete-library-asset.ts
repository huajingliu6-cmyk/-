import "server-only";

import { withProjectApprovalLock } from "@/projects/assets/approvals/lock";
import {
  loadAssetBundleForScope,
  saveAssetBundleForScope,
  type AssetBundleStoreScope,
} from "@/projects/assets/asset-bundle-scope";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  analyzeAssetReferenceImpact,
  formatAssetInUseMessage,
  type AssetReferenceImpact,
  type LibraryAssetKind,
} from "@/projects/assets/asset-reference-impact";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import {
  loadWorkspace,
  updateWorkspaceUnderLock,
} from "@/projects/storyboard/production-store";
import type {
  AssetMatchItem,
  EpisodeProduction,
  ProjectStoryboardWorkspace,
  ShotAssetRequirement,
  StoryboardDocument,
  StoryboardScene,
  StoryboardShot,
} from "@/projects/storyboard/types";
import { loadWorkspaceLocalAssets } from "@/projects/workspace-sync/store";

export type DeleteLibraryAssetResult =
  | {
      ok: true;
      kind: LibraryAssetKind;
      assetId: string;
      unlinkedStoryboard: boolean;
      impact: AssetReferenceImpact;
    }
  | {
      ok: false;
      code:
        | "ASSET_NOT_FOUND"
        | "ASSET_IN_USE"
        | "INVALID_ASSET_KIND"
        | "DELETE_CONFLICT";
      message: string;
      status: number;
      impact?: AssetReferenceImpact;
    };

function removeId(ids: string[], assetId: string): string[] {
  return ids.filter((id) => id !== assetId);
}

function unlinkRequirements(
  requirements: ShotAssetRequirement[],
  kind: LibraryAssetKind,
  assetId: string,
  now: string,
): ShotAssetRequirement[] {
  return requirements.map((requirement) => {
    if (requirement.type !== kind || requirement.selectedAssetId !== assetId) {
      return requirement;
    }
    return {
      ...requirement,
      selectedAssetId: null,
      resolution: "UNRESOLVED",
      updatedAt: now,
    };
  });
}

function unlinkAssetMatches(
  matches: AssetMatchItem[],
  kind: LibraryAssetKind,
  assetId: string,
): AssetMatchItem[] {
  return matches.map((match) => {
    if (match.assetType !== kind || match.matchedAssetId !== assetId) {
      return match;
    }
    return {
      ...match,
      matchedAssetId: null,
      matchedAssetName: null,
      matchedAssetRevision: null,
      resolution: "unresolved",
      confirmed: false,
    };
  });
}

function unlinkShot(
  shot: StoryboardShot,
  kind: LibraryAssetKind,
  assetId: string,
  now: string,
): { shot: StoryboardShot; changed: boolean } {
  let changed = false;
  let next: StoryboardShot = shot;

  if (kind === "character") {
    if (shot.characterAssetIds.includes(assetId)) {
      next = {
        ...next,
        characterAssetIds: removeId(next.characterAssetIds, assetId),
      };
      changed = true;
    }
    if (
      next.sceneCharacterPlacements?.some(
        (placement) => placement.characterAssetId === assetId,
      )
    ) {
      const placements = next.sceneCharacterPlacements.filter(
        (placement) => placement.characterAssetId !== assetId,
      );
      next = {
        ...next,
        sceneCharacterPlacements:
          placements.length > 0 ? placements : undefined,
      };
      changed = true;
    }
  }

  if (kind === "scene") {
    if (next.sceneAssetId === assetId) {
      next = { ...next, sceneAssetId: null };
      changed = true;
    }
    if (next.sceneAssetIds.includes(assetId)) {
      next = {
        ...next,
        sceneAssetIds: removeId(next.sceneAssetIds, assetId),
      };
      changed = true;
    }
  }

  if (kind === "prop" && next.propAssetIds.includes(assetId)) {
    next = { ...next, propAssetIds: removeId(next.propAssetIds, assetId) };
    changed = true;
  }

  if (next.assetMediaIds && assetId in next.assetMediaIds) {
    const media = { ...next.assetMediaIds };
    delete media[assetId];
    next = {
      ...next,
      assetMediaIds: Object.keys(media).length > 0 ? media : undefined,
    };
    changed = true;
  }

  const requirements = unlinkRequirements(
    next.requirements ?? [],
    kind,
    assetId,
    now,
  );
  if (
    requirements.some(
      (requirement, index) => requirement !== (next.requirements ?? [])[index],
    )
  ) {
    next = { ...next, requirements };
    changed = true;
  }

  return { shot: next, changed };
}

function unlinkScene(
  scene: StoryboardScene,
  kind: LibraryAssetKind,
  assetId: string,
  now: string,
): { scene: StoryboardScene; changed: boolean } {
  let changed = false;
  let next: StoryboardScene = scene;

  if (kind === "character" && next.characterAssetIds.includes(assetId)) {
    next = {
      ...next,
      characterAssetIds: removeId(next.characterAssetIds, assetId),
    };
    changed = true;
  }
  if (kind === "scene" && next.sceneAssetIds.includes(assetId)) {
    next = { ...next, sceneAssetIds: removeId(next.sceneAssetIds, assetId) };
    changed = true;
  }
  if (kind === "prop" && next.propAssetIds.includes(assetId)) {
    next = { ...next, propAssetIds: removeId(next.propAssetIds, assetId) };
    changed = true;
  }

  const shots = next.shots.map((shot) => {
    const result = unlinkShot(shot, kind, assetId, now);
    if (result.changed) changed = true;
    return result.shot;
  });
  if (changed) {
    next = { ...next, shots };
  }
  return { scene: next, changed };
}

function unlinkDocument(
  document: StoryboardDocument,
  kind: LibraryAssetKind,
  assetId: string,
  now: string,
): { document: StoryboardDocument; changed: boolean } {
  let changed = false;
  const scenes = document.scenes.map((scene) => {
    const result = unlinkScene(scene, kind, assetId, now);
    if (result.changed) changed = true;
    return result.scene;
  });
  return {
    document: changed ? { ...document, scenes } : document,
    changed,
  };
}

function unlinkProduction(
  production: EpisodeProduction,
  kind: LibraryAssetKind,
  assetId: string,
  now: string,
): { production: EpisodeProduction; changed: boolean } {
  let changed = false;
  const assetMatches = unlinkAssetMatches(
    production.assetMatches ?? [],
    kind,
    assetId,
  );
  if (
    assetMatches.some(
      (match, index) => match !== (production.assetMatches ?? [])[index],
    )
  ) {
    changed = true;
  }

  let activeStoryboard = production.activeStoryboard;
  if (activeStoryboard) {
    const result = unlinkDocument(activeStoryboard, kind, assetId, now);
    if (result.changed) {
      activeStoryboard = result.document;
      changed = true;
    }
  }

  if (!changed) return { production, changed: false };
  return {
    production: {
      ...production,
      assetMatches,
      activeStoryboard,
      updatedAt: now,
      lastEditedAt: now,
    },
    changed: true,
  };
}

export function unlinkAssetFromStoryboardWorkspace(
  workspace: ProjectStoryboardWorkspace,
  kind: LibraryAssetKind,
  assetId: string,
  now = new Date().toISOString(),
): { workspace: ProjectStoryboardWorkspace; changed: boolean } {
  let changed = false;
  const productions = workspace.productions.map((production) => {
    const result = unlinkProduction(production, kind, assetId, now);
    if (result.changed) changed = true;
    return result.production;
  });
  if (!changed) return { workspace, changed: false };
  return {
    workspace: {
      ...workspace,
      productions,
      updatedAt: now,
    },
    changed: true,
  };
}

function removeAssetFromBundle(
  bundle: ProjectAssetBundle | AssetBundleDraft,
  kind: LibraryAssetKind,
  assetId: string,
): ProjectAssetBundle {
  if (kind === "character") {
    return {
      ...bundle,
      characters: bundle.characters.filter((asset) => asset.id !== assetId),
    };
  }
  if (kind === "scene") {
    return {
      ...bundle,
      scenes: bundle.scenes.filter((asset) => asset.id !== assetId),
    };
  }
  return {
    ...bundle,
    props: bundle.props.filter((asset) => asset.id !== assetId),
  };
}

function bundleHasAsset(
  bundle: ProjectAssetBundle | AssetBundleDraft,
  kind: LibraryAssetKind,
  assetId: string,
): boolean {
  if (kind === "character") {
    return bundle.characters.some((asset) => asset.id === assetId);
  }
  if (kind === "scene") {
    return bundle.scenes.some((asset) => asset.id === assetId);
  }
  return bundle.props.some((asset) => asset.id === assetId);
}

/**
 * Delete a library asset row. Never deletes image/audio blobs.
 * Default refuses when storyboard still references the asset (409 ASSET_IN_USE).
 * With unlinkStoryboardRefs=true, clears refs then removes the asset row.
 */
export async function deleteLibraryAsset(params: {
  projectId: string;
  scope: AssetBundleStoreScope;
  kind: LibraryAssetKind;
  assetId: string;
  unlinkStoryboardRefs?: boolean;
}): Promise<DeleteLibraryAssetResult> {
  const assetId = params.assetId.trim();
  if (!assetId) {
    return {
      ok: false,
      code: "ASSET_NOT_FOUND",
      message: "资产不存在",
      status: 404,
    };
  }

  return withProjectApprovalLock(params.projectId, async () => {
    // Workspace mutations must touch the local workspace store only — never the
    // effective merge (which may include management snapshot rows).
    const previousBundle =
      params.scope === "workspace"
        ? await loadWorkspaceLocalAssets(params.projectId)
        : await loadAssetBundleForScope(params.projectId, params.scope);
    if (!previousBundle || !bundleHasAsset(previousBundle, params.kind, assetId)) {
      return {
        ok: false,
        code: "ASSET_NOT_FOUND",
        message: "资产不存在",
        status: 404,
      };
    }

    const previousWorkspace = await loadWorkspace(params.projectId);
    const impact = await analyzeAssetReferenceImpact({
      projectId: params.projectId,
      scope: params.scope,
      kind: params.kind,
      assetId,
      workspace: previousWorkspace,
    });

    if (impact.inUse && !params.unlinkStoryboardRefs) {
      return {
        ok: false,
        code: "ASSET_IN_USE",
        message: formatAssetInUseMessage(impact),
        status: 409,
        impact,
      };
    }

    let storyboardSaved: ProjectStoryboardWorkspace | null = null;
    let didUnlinkStoryboard = false;
    let workspaceSnapshotBeforeUnlink: ProjectStoryboardWorkspace | null = null;

    try {
      if (impact.inUse && params.unlinkStoryboardRefs && previousWorkspace) {
        storyboardSaved = await updateWorkspaceUnderLock(
          params.projectId,
          async (latest) => {
            if (!latest) return null;
            workspaceSnapshotBeforeUnlink = latest;
            const unlinked = unlinkAssetFromStoryboardWorkspace(
              latest,
              params.kind,
              assetId,
            );
            if (!unlinked.changed) return null;
            return unlinked.workspace;
          },
        );
        if (
          storyboardSaved &&
          workspaceSnapshotBeforeUnlink &&
          storyboardSaved !== workspaceSnapshotBeforeUnlink
        ) {
          didUnlinkStoryboard = true;

          const residual = await analyzeAssetReferenceImpact({
            projectId: params.projectId,
            scope: params.scope,
            kind: params.kind,
            assetId,
            workspace: storyboardSaved,
          });
          if (residual.inUse) {
            await updateWorkspaceUnderLock(params.projectId, async () => {
              return workspaceSnapshotBeforeUnlink;
            });
            return {
              ok: false,
              code: "DELETE_CONFLICT",
              message: "解除分镜引用后仍检测到残留引用，已恢复分镜数据",
              status: 409,
              impact: residual,
            };
          }
        }
      }

      const nextBundle = removeAssetFromBundle(
        previousBundle,
        params.kind,
        assetId,
      );
      try {
        await saveAssetBundleForScope({
          scope: params.scope,
          previous: previousBundle,
          next: nextBundle,
        });
      } catch (error) {
        if (didUnlinkStoryboard && workspaceSnapshotBeforeUnlink) {
          try {
            await updateWorkspaceUnderLock(params.projectId, async () => {
              return workspaceSnapshotBeforeUnlink;
            });
          } catch (restoreError) {
            console.error(
              `[delete-library-asset] storyboard restore failed for ${params.projectId}:`,
              restoreError,
            );
          }
        }
        throw error;
      }

      const result: DeleteLibraryAssetResult = {
        ok: true,
        kind: params.kind,
        assetId,
        unlinkedStoryboard: didUnlinkStoryboard,
        impact,
      };
      return result;
    } catch (error) {
      console.error(
        `[delete-library-asset] failed for ${params.projectId}/${params.kind}/${assetId}:`,
        error,
      );
      return {
        ok: false,
        code: "DELETE_CONFLICT",
        message: "删除失败，数据已尽量恢复，请重试",
        status: 409,
        impact,
      };
    }
  });
}
