import "server-only";

import {
  listImageGenerationJobs,
} from "@/projects/assets/image-generation/store";
import {
  IMAGE_JOB_ACTIVE_STATUSES,
  isTempReferenceStorageKey,
  type ImageGenerationJob,
} from "@/projects/assets/image-generation/types";
import type { AssetBundleStoreScope } from "@/projects/assets/asset-bundle-scope";
import {
  deleteTempReferenceImage,
  listTempReferenceImages,
  type TempReferenceMeta,
} from "@/projects/assets/image-generation/temp-reference-storage";

export type TempReferenceUsage = {
  meta: TempReferenceMeta;
  referencingJobIds: string[];
  activeJobIds: string[];
  refCount: number;
  usedByActiveJob: boolean;
};

function jobReferenceKeys(job: ImageGenerationJob): string[] {
  const snap = job.params.retrySnapshot;
  if (snap?.referenceStorageKeys?.length) {
    return snap.referenceStorageKeys.filter(isTempReferenceStorageKey);
  }
  return [];
}

export async function collectTempReferenceUsage(input: {
  projectId: string;
  scope: AssetBundleStoreScope;
}): Promise<TempReferenceUsage[]> {
  const [metas, jobs] = await Promise.all([
    listTempReferenceImages(input.projectId),
    listImageGenerationJobs({
      projectId: input.projectId,
      scope: input.scope,
    }),
  ]);

  return metas.map((meta) => {
    const referencingJobIds: string[] = [];
    const activeJobIds: string[] = [];
    for (const job of jobs) {
      if (!jobReferenceKeys(job).includes(meta.storageKey)) continue;
      referencingJobIds.push(job.id);
      if (IMAGE_JOB_ACTIVE_STATUSES.includes(job.status)) {
        activeJobIds.push(job.id);
      }
    }
    return {
      meta,
      referencingJobIds,
      activeJobIds,
      refCount: referencingJobIds.length,
      usedByActiveJob: activeJobIds.length > 0,
    };
  });
}

/**
 * Delete a temp reference with refcount / active-job rules.
 */
export async function deleteTempReferenceWithPolicy(input: {
  projectId: string;
  scope: AssetBundleStoreScope;
  storageKey: string;
  /** When true, allow delete even if sole active job uses it (worker holds memory). */
  allowWhileActiveSoleUse?: boolean;
}): Promise<
  | { ok: true }
  | {
      ok: false;
      code: string;
      message: string;
      status: number;
      referencingJobIds?: string[];
    }
> {
  if (!isTempReferenceStorageKey(input.storageKey)) {
    return {
      ok: false,
      code: "FORBIDDEN_STORAGE_KEY",
      message: "只能删除临时参考图，不能删除正式资产文件。",
      status: 403,
    };
  }

  const usages = await collectTempReferenceUsage({
    projectId: input.projectId,
    scope: input.scope,
  });
  const usage = usages.find((u) => u.meta.storageKey === input.storageKey);

  if (!usage) {
    // Orphan meta / already gone — try delete anyway
    return deleteTempReferenceImage({
      projectId: input.projectId,
      storageKey: input.storageKey,
    });
  }

  if (usage.refCount === 0) {
    return deleteTempReferenceImage({
      projectId: input.projectId,
      storageKey: input.storageKey,
    });
  }

  // Shared across jobs (history or active) — block unless sole active and allowed
  if (usage.refCount > 1) {
    return {
      ok: false,
      code: "TEMP_REF_IN_USE",
      message: `该参考图仍被 ${usage.refCount} 个任务引用，请先删除相关任务记录后再删除参考图。`,
      status: 409,
      referencingJobIds: usage.referencingJobIds,
    };
  }

  // Single job reference
  const onlyJobId = usage.referencingJobIds[0]!;
  if (usage.activeJobIds.includes(onlyJobId)) {
    if (!input.allowWhileActiveSoleUse) {
      return {
        ok: false,
        code: "TEMP_REF_ACTIVE",
        message:
          "该参考图正被运行中的任务使用。确认后可删除磁盘副本，当前任务将继续使用内存中的图片。",
        status: 409,
        referencingJobIds: usage.referencingJobIds,
      };
    }
    return deleteTempReferenceImage({
      projectId: input.projectId,
      storageKey: input.storageKey,
    });
  }

  // Referenced only by historical/failed job — require clearing that record first
  return {
    ok: false,
    code: "TEMP_REF_HISTORY",
    message:
      "该参考图仍被历史任务记录引用。请先删除对应任务的未入库结果或记录后再删除参考图。",
    status: 409,
    referencingJobIds: usage.referencingJobIds,
  };
}

/**
 * Bulk-delete only unreferenced tmpref_* files. Referenced keys are skipped.
 */
export async function bulkDeleteUnreferencedTempReferences(input: {
  projectId: string;
  scope: AssetBundleStoreScope;
  storageKeys: string[];
}): Promise<{
  deleted: string[];
  skipped: Array<{ storageKey: string; reason: string; code: string }>;
}> {
  const deleted: string[] = [];
  const skipped: Array<{ storageKey: string; reason: string; code: string }> =
    [];
  const usages = await collectTempReferenceUsage({
    projectId: input.projectId,
    scope: input.scope,
  });
  const byKey = new Map(usages.map((u) => [u.meta.storageKey, u]));

  for (const storageKey of input.storageKeys) {
    if (!isTempReferenceStorageKey(storageKey)) {
      skipped.push({
        storageKey,
        reason: "只能删除临时参考图命名空间内的文件",
        code: "FORBIDDEN_STORAGE_KEY",
      });
      continue;
    }
    const usage = byKey.get(storageKey);
    if (usage && usage.refCount > 0) {
      skipped.push({
        storageKey,
        reason: usage.usedByActiveJob
          ? "运行中任务仍引用该文件"
          : `仍被 ${usage.refCount} 个任务引用`,
        code: usage.usedByActiveJob ? "TEMP_REF_ACTIVE" : "TEMP_REF_IN_USE",
      });
      continue;
    }
    const result = await deleteTempReferenceImage({
      projectId: input.projectId,
      storageKey,
    });
    if (result.ok) {
      deleted.push(storageKey);
    } else {
      skipped.push({
        storageKey,
        reason: result.message,
        code: result.code,
      });
    }
  }

  return { deleted, skipped };
}
