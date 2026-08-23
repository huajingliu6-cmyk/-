import "server-only";

import {
  loadAssetBundleDraft,
  type AssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import type { AssetBundleStoreScope } from "@/projects/assets/asset-bundle-scope";
import { isExclusiveGeneratedMediaBlob } from "@/projects/assets/character-media-state";
import type {
  CharacterAsset,
  ProjectAssetBundle,
} from "@/projects/assets/types";
import { listImageGenerationJobs } from "@/projects/assets/image-generation/store";
import type { ImageGenerationJob } from "@/projects/assets/image-generation/types";
import { loadWorkspaceLocalAssets } from "@/projects/workspace-sync/store";
import { resolveCharacterPrimaryMediaId } from "@/projects/assets/character-media-state";
import { mergeMediaIdLists } from "@/projects/assets/episode-design/generated-media-history";

export type CharacterLookBlobDeletion =
  | "deleted"
  | "skipped_not_gen"
  | "skipped_unknown_provenance"
  | "skipped_formal_or_shared"
  | "skipped_other_refs";

export type CharacterLookBlobDeletionDecision = {
  blobDeletion: CharacterLookBlobDeletion;
  shouldDeleteBlob: boolean;
  reason: string;
};

function assetRefsMedia(
  asset: {
    id: string;
    primaryMediaId?: string | null;
    imageFileName?: string | null;
    approvedMediaIds?: string[];
    historyMediaIds?: string[];
    lookMediaIds?: string[];
    approvalProvenance?: { generatedMediaId?: string } | null;
  },
  mediaId: string,
): boolean {
  if (asset.primaryMediaId === mediaId) return true;
  if (asset.imageFileName === mediaId) return true;
  if (asset.approvalProvenance?.generatedMediaId === mediaId) return true;
  return mergeMediaIdLists(
    asset.approvedMediaIds,
    asset.historyMediaIds,
    asset.lookMediaIds,
  ).includes(mediaId);
}

function countMediaOwners(
  bundle: ProjectAssetBundle | AssetBundleDraft | null | undefined,
  mediaId: string,
  excludeCharacterId: string,
): number {
  if (!bundle) return 0;
  let count = 0;
  for (const character of bundle.characters) {
    if (character.id === excludeCharacterId) continue;
    if (assetRefsMedia(character, mediaId)) count += 1;
  }
  for (const scene of bundle.scenes) {
    if (assetRefsMedia(scene, mediaId)) count += 1;
  }
  for (const prop of bundle.props) {
    if (assetRefsMedia(prop, mediaId)) count += 1;
  }
  return count;
}

function hasApprovalOrFormalProvenance(
  character: CharacterAsset,
  mediaId: string,
  bundles: Array<ProjectAssetBundle | AssetBundleDraft | null | undefined>,
): boolean {
  if (character.approvalProvenance?.generatedMediaId === mediaId) {
    return true;
  }
  const primary = resolveCharacterPrimaryMediaId(character);
  // Deleting the current primary blob is never allowed via look-delete path
  // while it is still primary; after clear, formal promote provenance still blocks.
  if (primary === mediaId) return true;

  for (const bundle of bundles) {
    if (!bundle) continue;
    for (const asset of [
      ...bundle.characters,
      ...bundle.scenes,
      ...bundle.props,
    ]) {
      if (asset.approvalProvenance?.generatedMediaId === mediaId) return true;
      if (asset.primaryMediaId === mediaId && asset.id !== character.id) {
        return true;
      }
    }
  }
  return false;
}

function hasLibraryLookJobProvenance(input: {
  jobs: ImageGenerationJob[];
  characterId: string;
  mediaId: string;
  scope: AssetBundleStoreScope;
}): boolean {
  return input.jobs.some((job) => {
    if (job.scope !== input.scope) return false;
    if (job.subjectId !== input.characterId) return false;
    if (job.subjectKind !== "library_character") return false;
    if (job.sourceEntry !== "library_look") return false;
    const ids = [
      ...(job.mediaIds ?? []),
      ...(job.primaryMediaId ? [job.primaryMediaId] : []),
    ];
    return ids.includes(input.mediaId);
  });
}

function hasRecordedLookProvenance(
  character: CharacterAsset,
  mediaId: string,
): boolean {
  const entry = character.mediaLookProvenance?.[mediaId];
  return entry?.kind === "library_look_generation";
}

/**
 * Decide whether a look media blob may be physically deleted.
 * Never deletes based on gen_* prefix alone.
 */
export async function decideCharacterLookBlobDeletion(input: {
  projectId: string;
  scope: AssetBundleStoreScope;
  character: CharacterAsset;
  mediaId: string;
  /** Character state AFTER look reference removal (for shared-ref checks). */
  characterAfterRemoval: CharacterAsset;
}): Promise<CharacterLookBlobDeletionDecision> {
  const mediaId = input.mediaId.trim();
  if (!isExclusiveGeneratedMediaBlob(mediaId)) {
    return {
      blobDeletion: "skipped_not_gen",
      shouldDeleteBlob: false,
      reason: "非 gen_* 生成图，保留 Blob",
    };
  }

  const [management, workspaceLocal, jobs] = await Promise.all([
    loadAssetBundleDraft(input.projectId),
    loadWorkspaceLocalAssets(input.projectId),
    listImageGenerationJobs({
      projectId: input.projectId,
      scope: input.scope,
      subjectId: input.character.id,
    }),
  ]);

  const bundles = [management, workspaceLocal];

  if (
    hasApprovalOrFormalProvenance(input.character, mediaId, bundles) ||
    hasApprovalOrFormalProvenance(
      input.characterAfterRemoval,
      mediaId,
      bundles,
    )
  ) {
    return {
      blobDeletion: "skipped_formal_or_shared",
      shouldDeleteBlob: false,
      reason: "审批/正式资产引用，禁止删除 Blob",
    };
  }

  const otherRefs =
    countMediaOwners(management, mediaId, input.character.id) +
    countMediaOwners(workspaceLocal, mediaId, input.character.id);
  // characterAfterRemoval may still list media in history — treat as self refs OK.
  if (otherRefs > 0) {
    return {
      blobDeletion: "skipped_other_refs",
      shouldDeleteBlob: false,
      reason: "仍被其他角色或资产引用，禁止删除 Blob",
    };
  }

  const owned =
    hasRecordedLookProvenance(input.character, mediaId) ||
    hasLibraryLookJobProvenance({
      jobs,
      characterId: input.character.id,
      mediaId,
      scope: input.scope,
    });

  if (!owned) {
    return {
      blobDeletion: "skipped_unknown_provenance",
      shouldDeleteBlob: false,
      reason: "缺少图生图造型 provenance，仅清理引用",
    };
  }

  return {
    blobDeletion: "deleted",
    shouldDeleteBlob: true,
    reason: "确认属于 library_look 生成且无其他引用",
  };
}
