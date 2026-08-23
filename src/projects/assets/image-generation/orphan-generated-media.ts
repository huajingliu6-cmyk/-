import "server-only";

import { promises as fs } from "fs";
import path from "path";
import {
  assetImagesDir,
  isSafeProjectAssetImageId,
  deleteProjectAssetImageFile,
} from "@/projects/assets/asset-image-storage";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import type { AssetBundleStoreScope } from "@/projects/assets/asset-bundle-scope";
import { isExclusiveGeneratedMediaBlob } from "@/projects/assets/character-media-state";
import { listImageGenerationJobs } from "@/projects/assets/image-generation/store";
import { IMAGE_JOB_ACTIVE_STATUSES } from "@/projects/assets/image-generation/types";
import { loadWorkspaceLocalAssets } from "@/projects/workspace-sync/store";
import { getEffectiveWorkspaceAssetBundle } from "@/projects/workspace-sync/workspace-episode-design-api";
import { mergeMediaIdLists } from "@/projects/assets/episode-design/generated-media-history";
import type {
  CharacterAsset,
  ProjectAssetBundle,
} from "@/projects/assets/types";
import { getProjectAssetImageUrl } from "@/projects/assets/asset-image-url";

export type GeneratedMediaCleanupCategory =
  | "safe_to_delete"
  | "referenced"
  | "unknown_provenance";

export type GeneratedMediaCleanupItem = {
  storageKey: string;
  sizeBytes: number;
  createdAt: string;
  category: GeneratedMediaCleanupCategory;
  label: string;
  refCount: number;
  usedByActiveJob: boolean;
  hasLibraryLookProvenance: boolean;
  previewUrl: string;
};

export type ManualGeneratedMediaDeleteResult =
  | { ok: true; deleted: true }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      blobDeletion?: string;
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
    mediaLookProvenance?: CharacterAsset["mediaLookProvenance"];
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

function collectRefs(
  bundle: ProjectAssetBundle | null | undefined,
  mediaId: string,
): {
  refCount: number;
  hasLookProvenance: boolean;
  isFormalOrApproval: boolean;
} {
  if (!bundle) {
    return { refCount: 0, hasLookProvenance: false, isFormalOrApproval: false };
  }
  let refCount = 0;
  let hasLookProvenance = false;
  let isFormalOrApproval = false;
  for (const character of bundle.characters) {
    if (assetRefsMedia(character, mediaId)) refCount += 1;
    if (character.mediaLookProvenance?.[mediaId]?.kind === "library_look_generation") {
      hasLookProvenance = true;
    }
    if (character.approvalProvenance?.generatedMediaId === mediaId) {
      isFormalOrApproval = true;
    }
    if (character.primaryMediaId === mediaId) {
      isFormalOrApproval = true;
    }
  }
  for (const scene of bundle.scenes) {
    if (assetRefsMedia(scene, mediaId)) {
      refCount += 1;
      if (scene.primaryMediaId === mediaId) isFormalOrApproval = true;
      if (scene.approvalProvenance?.generatedMediaId === mediaId) {
        isFormalOrApproval = true;
      }
    }
  }
  for (const prop of bundle.props) {
    if (assetRefsMedia(prop, mediaId)) {
      refCount += 1;
      if (prop.primaryMediaId === mediaId) isFormalOrApproval = true;
      if (prop.approvalProvenance?.generatedMediaId === mediaId) {
        isFormalOrApproval = true;
      }
    }
  }
  return { refCount, hasLookProvenance, isFormalOrApproval };
}

async function listGenMediaKeysOnDisk(projectId: string): Promise<
  Array<{ storageKey: string; sizeBytes: number; createdAt: string }>
> {
  const dir = assetImagesDir(projectId);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: Array<{ storageKey: string; sizeBytes: number; createdAt: string }> =
    [];
  for (const name of entries) {
    if (!isExclusiveGeneratedMediaBlob(name)) continue;
    if (!isSafeProjectAssetImageId(name)) continue;
    if (name.includes(".")) continue;
    try {
      const stat = await fs.stat(path.join(dir, name));
      if (!stat.isFile()) continue;
      out.push({
        storageKey: name,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      });
    } catch {
      // skip
    }
  }
  return out;
}

/**
 * Classify on-disk gen_* blobs for the temporary-files cleanup UI.
 * Never auto-upgrades unknown provenance to safe_to_delete.
 */
export async function listGeneratedMediaCleanupItems(input: {
  projectId: string;
  scope: AssetBundleStoreScope;
  context: "management" | "workspace";
}): Promise<GeneratedMediaCleanupItem[]> {
  const [disk, management, workspaceLocal, effective, jobs] = await Promise.all([
    listGenMediaKeysOnDisk(input.projectId),
    loadAssetBundleDraft(input.projectId),
    loadWorkspaceLocalAssets(input.projectId),
    input.scope === "workspace"
      ? getEffectiveWorkspaceAssetBundle(input.projectId)
      : Promise.resolve(null),
    listImageGenerationJobs({ projectId: input.projectId, scope: input.scope }),
  ]);

  const bundles = [management, workspaceLocal, effective];

  return disk.map((file) => {
    let refCount = 0;
    let hasLibraryLookProvenance = false;
    let isFormalOrApproval = false;
    for (const bundle of bundles) {
      const refs = collectRefs(bundle, file.storageKey);
      refCount += refs.refCount;
      hasLibraryLookProvenance =
        hasLibraryLookProvenance || refs.hasLookProvenance;
      isFormalOrApproval = isFormalOrApproval || refs.isFormalOrApproval;
    }

    const usedByActiveJob = jobs.some((job) => {
      if (!IMAGE_JOB_ACTIVE_STATUSES.includes(job.status)) return false;
      const ids = [
        ...(job.mediaIds ?? []),
        ...(job.primaryMediaId ? [job.primaryMediaId] : []),
      ];
      return ids.includes(file.storageKey);
    });

    let category: GeneratedMediaCleanupCategory;
    let label: string;
    if (refCount > 0 || isFormalOrApproval || usedByActiveJob) {
      category = "referenced";
      label = "有引用不可删除";
    } else if (hasLibraryLookProvenance) {
      category = "safe_to_delete";
      label = "可安全删除";
    } else {
      category = "unknown_provenance";
      label = "来源未知，需人工确认";
    }

    return {
      storageKey: file.storageKey,
      sizeBytes: file.sizeBytes,
      createdAt: file.createdAt,
      category,
      label,
      refCount,
      usedByActiveJob,
      hasLibraryLookProvenance,
      previewUrl: getProjectAssetImageUrl(input.projectId, file.storageKey, {
        revision: file.createdAt,
        context: input.context,
      }),
    };
  });
}

/**
 * Manual confirm delete for unknown / safe gen_* blobs.
 * Never auto-upgrades unknown → safe; always re-validates server-side.
 */
export async function manuallyDeleteGeneratedMediaBlob(input: {
  projectId: string;
  scope: AssetBundleStoreScope;
  storageKey: string;
  /** Required for unknown_provenance category. */
  confirmUnknown?: boolean;
}): Promise<ManualGeneratedMediaDeleteResult> {
  const storageKey = input.storageKey.trim();
  if (!isExclusiveGeneratedMediaBlob(storageKey)) {
    return {
      ok: false,
      status: 400,
      code: "FORBIDDEN_STORAGE_KEY",
      message: "仅允许确认删除 gen_* 生成图",
      blobDeletion: "skipped_not_gen",
    };
  }

  const items = await listGeneratedMediaCleanupItems({
    projectId: input.projectId,
    scope: input.scope,
    context: input.scope,
  });
  const item = items.find((row) => row.storageKey === storageKey);
  if (!item) {
    return {
      ok: false,
      status: 404,
      code: "MEDIA_NOT_FOUND",
      message: "生成图不存在",
    };
  }

  if (item.category === "referenced") {
    return {
      ok: false,
      status: 409,
      code: "GENERATED_MEDIA_IN_USE",
      message: "仍被资产或任务引用，禁止删除",
      blobDeletion: "skipped_other_refs",
    };
  }

  if (item.category === "unknown_provenance" && !input.confirmUnknown) {
    return {
      ok: false,
      status: 400,
      code: "UNKNOWN_PROVENANCE_CONFIRM_REQUIRED",
      message: "来源未知，需人工确认后才能删除",
      blobDeletion: "skipped_unknown_provenance",
    };
  }

  // Re-check formal / approval / active job at delete time (fail closed).
  const [management, workspaceLocal, jobs] = await Promise.all([
    loadAssetBundleDraft(input.projectId),
    loadWorkspaceLocalAssets(input.projectId),
    listImageGenerationJobs({
      projectId: input.projectId,
      scope: input.scope,
    }),
  ]);
  for (const bundle of [management, workspaceLocal]) {
    const refs = collectRefs(bundle, storageKey);
    if (refs.refCount > 0 || refs.isFormalOrApproval) {
      return {
        ok: false,
        status: 409,
        code: "GENERATED_MEDIA_IN_USE",
        message: "二次校验发现引用或正式资产，已禁止删除",
        blobDeletion: "skipped_formal_or_shared",
      };
    }
  }
  const active = jobs.some((job) => {
    if (!IMAGE_JOB_ACTIVE_STATUSES.includes(job.status)) return false;
    const ids = [
      ...(job.mediaIds ?? []),
      ...(job.primaryMediaId ? [job.primaryMediaId] : []),
    ];
    return ids.includes(storageKey);
  });
  if (active) {
    return {
      ok: false,
      status: 409,
      code: "GENERATED_MEDIA_ACTIVE_JOB",
      message: "仍被活动生成任务引用，禁止删除",
      blobDeletion: "skipped_other_refs",
    };
  }

  await deleteProjectAssetImageFile(input.projectId, storageKey);
  return { ok: true, deleted: true };
}
