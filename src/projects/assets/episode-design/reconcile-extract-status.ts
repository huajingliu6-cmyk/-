/**
 * Reconcile persisted "generating" extract status against TextGenerationJob.
 * Used on GET detail so remount never blindly unlocks or fails a live job.
 */

import { applyParsedDesignToEpisodeRecord } from "@/projects/assets/episode-design/apply-generation";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { parseEpisodeAssetDesignOutput } from "@/projects/assets/episode-design/schema";
import type {
  EpisodeAssetActiveGeneration,
  EpisodeAssetDesignRecord,
} from "@/projects/assets/episode-design/types";
import { SCRIPT_ASSET_DESIGN_ID } from "@/projects/assets/episode-design/types";
import {
  isStaleTextJob,
  reclaimStaleTextJob,
} from "@/text-generation/stale-job";
import { resolveTimeoutMsForOutputKind } from "@/text-generation/generation-abort";
import { getTextJob } from "@/text-generation/job-store";
import type { TextOutputKind } from "@/text-generation/types";

export function parseActiveGeneration(
  raw: unknown,
): EpisodeAssetActiveGeneration | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const outputKind = obj.outputKind;
  if (
    outputKind !== "script_asset_design" &&
    outputKind !== "episode_asset_design"
  ) {
    return null;
  }
  const idempotencyKey =
    typeof obj.idempotencyKey === "string" ? obj.idempotencyKey.trim() : "";
  const startedAt =
    typeof obj.startedAt === "string" ? obj.startedAt : "";
  const updatedAt =
    typeof obj.updatedAt === "string" ? obj.updatedAt : startedAt;
  if (!idempotencyKey || !startedAt) return null;
  return {
    generationId:
      typeof obj.generationId === "string" && obj.generationId.trim()
        ? obj.generationId.trim()
        : null,
    idempotencyKey,
    outputKind,
    startedAt,
    updatedAt: updatedAt || startedAt,
  };
}

function clearActive(
  record: EpisodeAssetDesignRecord,
  status: EpisodeAssetDesignRecord["status"],
): EpisodeAssetDesignRecord {
  return {
    ...record,
    status,
    activeGeneration: null,
    updatedAt: new Date().toISOString(),
  };
}

function isPastLegacyTimeout(
  record: EpisodeAssetDesignRecord,
  outputKind: TextOutputKind,
  nowMs: number,
): boolean {
  const updatedAtMs = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return true;
  const timeoutMs = resolveTimeoutMsForOutputKind(outputKind);
  // Match stale-job grace so remount does not fail early.
  return nowMs - updatedAtMs > timeoutMs + 15_000;
}

export type ReconcileExtractPersist = (input: {
  record: EpisodeAssetDesignRecord;
}) => Promise<EpisodeAssetDesignRecord>;

/**
 * If record is generating, sync with the text job (and optionally apply completed output).
 * Never fails solely because the React tree remounted.
 */
export async function reconcileGeneratingExtractRecord(input: {
  projectId: string;
  record: EpisodeAssetDesignRecord;
  fingerprint: string;
  episodeContent: string;
  episodeNumber: number;
  episodeTitle: string;
  persist: ReconcileExtractPersist;
  nowMs?: number;
}): Promise<EpisodeAssetDesignRecord> {
  if (input.record.status !== "generating") {
    return input.record;
  }

  const nowMs = input.nowMs ?? Date.now();
  const active = input.record.activeGeneration ?? null;
  const outputKind: TextOutputKind =
    active?.outputKind ??
    (input.record.episodeId === SCRIPT_ASSET_DESIGN_ID
      ? "script_asset_design"
      : "episode_asset_design");

  if (!active?.generationId) {
    // Legacy rows: keep busy until timeout window expires.
    if (!isPastLegacyTimeout(input.record, outputKind, nowMs)) {
      return input.record;
    }
    const failed = clearActive(input.record, "failed");
    return input.persist({ record: failed });
  }

  let job = await getTextJob(input.projectId, active.generationId);
  if (!job) {
    if (!isPastLegacyTimeout(input.record, outputKind, nowMs)) {
      return input.record;
    }
    const failed = clearActive(input.record, "failed");
    return input.persist({ record: failed });
  }

  if (
    (job.status === "queued" || job.status === "running") &&
    isStaleTextJob(job, nowMs)
  ) {
    job = await reclaimStaleTextJob(job);
  }

  if (job.status === "queued" || job.status === "running") {
    return input.record;
  }

  if (job.status === "failed" || job.status === "cancelled") {
    const failed = clearActive(
      {
        ...input.record,
        generationId: job.generationId,
      },
      "failed",
    );
    return input.persist({ record: failed });
  }

  if (job.status === "completed") {
    if (!job.content.trim()) {
      const failed = clearActive(input.record, "failed");
      return input.persist({ record: failed });
    }
    // Already applied (items present + generationId match) → just clear busy.
    if (
      input.record.generationId === job.generationId &&
      input.record.items.length > 0 &&
      input.record.status === "generating"
    ) {
      // Still marked generating but apply already happened somehow — promote to review.
    }
    const parsed = parseEpisodeAssetDesignOutput(job.content);
    if (!parsed.ok) {
      const failed = clearActive(input.record, "failed");
      return input.persist({ record: failed });
    }
    if (!input.episodeContent.trim()) {
      return input.record;
    }
    const bundle =
      (await loadAssetBundleDraft(input.projectId)) ?? {
        projectId: input.projectId,
        characters: [],
        scenes: [],
        props: [],
        audios: [],
      };
    const applied = applyParsedDesignToEpisodeRecord({
      record: input.record,
      parsed: parsed.value,
      bundle,
      contentFingerprint: input.fingerprint,
      generationId: job.generationId,
    });
    const next: EpisodeAssetDesignRecord = {
      ...applied,
      activeGeneration: null,
      status: "review",
    };
    return input.persist({ record: next });
  }

  return input.record;
}

/** True when a live extract should block a new paid generation. */
export function isExtractInProgress(
  record: EpisodeAssetDesignRecord | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!record || record.status !== "generating") return false;
  const active = record.activeGeneration;
  const outputKind: TextOutputKind =
    active?.outputKind ??
    (record.episodeId === SCRIPT_ASSET_DESIGN_ID
      ? "script_asset_design"
      : "episode_asset_design");
  if (active?.generationId) {
    // Without async job lookup, treat as in-progress until reconcile clears it.
    // Callers that have the job should prefer job status.
    return !isPastLegacyTimeout(record, outputKind, nowMs);
  }
  return !isPastLegacyTimeout(record, outputKind, nowMs);
}
