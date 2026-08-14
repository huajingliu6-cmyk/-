import {
  getEpisodeDesignRecord,
  loadEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/store";
import { loadWorkspaceLocalEpisodeDesigns } from "@/projects/workspace-sync/store";
import { SCRIPT_ASSET_DESIGN_ID } from "@/projects/assets/episode-design/types";
import { isExtractInProgress } from "@/projects/assets/episode-design/reconcile-extract-status";
import { isStaleTextJob } from "@/text-generation/stale-job";
import { getTextJob } from "@/text-generation/job-store";

/**
 * Block a new paid asset-extract generation when a live job is already running.
 */
export async function findBlockingAssetExtract(input: {
  projectId: string;
  episodeId: string;
  /** Same extract handshake may PUT generating then start SSE with this key. */
  idempotencyKey?: string;
}): Promise<{ blocked: true; message: string } | { blocked: false }> {
  const store = await loadEpisodeAssetDesignStore(input.projectId);
  let record = getEpisodeDesignRecord(store, input.episodeId);

  try {
    const local = await loadWorkspaceLocalEpisodeDesigns(input.projectId);
    const localRecord = local.records.find((r) => r.episodeId === input.episodeId);
    if (localRecord?.status === "generating") {
      record = localRecord;
    }
  } catch {
    /* personal / management-only paths may not have workspace local */
  }

  if (!record || record.status !== "generating") {
    return { blocked: false };
  }

  const active = record.activeGeneration;
  const incomingKey = input.idempotencyKey?.trim() ?? "";
  if (
    incomingKey &&
    active?.idempotencyKey &&
    active.idempotencyKey === incomingKey
  ) {
    return { blocked: false };
  }

  const generationId = active?.generationId;
  if (generationId) {
    const job = await getTextJob(input.projectId, generationId);
    if (job && (job.status === "queued" || job.status === "running")) {
      if (!isStaleTextJob(job)) {
        return {
          blocked: true,
          message: "资产正在提取中，请勿重复提交",
        };
      }
      return { blocked: false };
    }
    if (job && job.status === "completed") {
      return {
        blocked: true,
        message: "资产正在提取中，请勿重复提交",
      };
    }
    return { blocked: false };
  }

  if (isExtractInProgress(record)) {
    return {
      blocked: true,
      message: "资产正在提取中，请勿重复提交",
    };
  }
  return { blocked: false };
}

export function assetExtractEpisodeIdForOutputKind(input: {
  outputKind: string;
  episodeId?: string | null;
}): string | null {
  if (input.outputKind === "script_asset_design") return SCRIPT_ASSET_DESIGN_ID;
  if (input.outputKind === "episode_asset_design") {
    const id = input.episodeId?.trim() ?? "";
    return id || null;
  }
  return null;
}
