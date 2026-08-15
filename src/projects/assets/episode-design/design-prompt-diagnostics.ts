/**
 * Safe diagnostics for asset extract + formal design-prompt generation.
 * Never log API keys, full scripts, full prompts, or private user content.
 */

import type { AssetDesignPromptState, EpisodeAssetDesignRecord } from "@/projects/assets/episode-design/types";
import { resolveTimeoutMsForOutputKind } from "@/text-generation/generation-abort";

export const DEFAULT_DESIGN_PROMPT_BATCH_CONCURRENCY = 4;
export const MAX_DESIGN_PROMPT_BATCH_CONCURRENCY = 6;

export const DEFAULT_DESIGN_PROMPT_BATCH_SIZE = 5;
export const MIN_DESIGN_PROMPT_BATCH_SIZE = 1;
export const MAX_DESIGN_PROMPT_BATCH_SIZE = 10;

export const DEFAULT_DESIGN_PROMPT_BATCH_REQUEST_CONCURRENCY = 3;
export const MIN_DESIGN_PROMPT_BATCH_REQUEST_CONCURRENCY = 2;
export const MAX_DESIGN_PROMPT_BATCH_REQUEST_CONCURRENCY = 5;

export function resolveDesignPromptBatchConcurrency(
  env: Record<string, string | undefined> = process.env,
  override?: number,
): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return Math.min(
      MAX_DESIGN_PROMPT_BATCH_CONCURRENCY,
      Math.max(1, Math.trunc(override)),
    );
  }
  const parsed = Number(env.DESIGN_PROMPT_BATCH_CONCURRENCY);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_DESIGN_PROMPT_BATCH_CONCURRENCY;
  }
  return Math.min(
    MAX_DESIGN_PROMPT_BATCH_CONCURRENCY,
    Math.max(1, Math.trunc(parsed)),
  );
}

export function resolveDesignPromptBatchSize(
  env: Record<string, string | undefined> = process.env,
  override?: number,
): number {
  const raw =
    typeof override === "number" && Number.isFinite(override)
      ? override
      : Number(env.DESIGN_PROMPT_BATCH_SIZE);
  if (!Number.isFinite(raw)) {
    return DEFAULT_DESIGN_PROMPT_BATCH_SIZE;
  }
  const truncated = Math.trunc(raw);
  if (
    truncated < MIN_DESIGN_PROMPT_BATCH_SIZE ||
    truncated > MAX_DESIGN_PROMPT_BATCH_SIZE
  ) {
    return DEFAULT_DESIGN_PROMPT_BATCH_SIZE;
  }
  return truncated;
}

export function resolveDesignPromptBatchRequestConcurrency(
  env: Record<string, string | undefined> = process.env,
  override?: number,
): number {
  const raw =
    typeof override === "number" && Number.isFinite(override)
      ? override
      : Number(env.DESIGN_PROMPT_BATCH_REQUEST_CONCURRENCY);
  if (!Number.isFinite(raw)) {
    return DEFAULT_DESIGN_PROMPT_BATCH_REQUEST_CONCURRENCY;
  }
  const truncated = Math.trunc(raw);
  if (
    truncated < MIN_DESIGN_PROMPT_BATCH_REQUEST_CONCURRENCY ||
    truncated > MAX_DESIGN_PROMPT_BATCH_REQUEST_CONCURRENCY
  ) {
    return DEFAULT_DESIGN_PROMPT_BATCH_REQUEST_CONCURRENCY;
  }
  return truncated;
}

export type AssetExtractDiagStatus = "completed" | "failed";

export function logAssetExtractRequest(fields: {
  projectId: string;
  episodeId: string;
  generationId: string;
  capabilityId: string;
  outputKind: string;
  messageRoles?: string;
  taskRuleSource?: string | null;
  taskRuleHash?: string | null;
  episodeChars: number;
  startedAt: string;
  finishedAt: string;
  status: AssetExtractDiagStatus;
  errorCode?: string | null;
}): void {
  console.info(
    JSON.stringify({
      event: "ASSET_EXTRACT_REQUEST",
      projectId: fields.projectId,
      episodeId: fields.episodeId,
      generationId: fields.generationId,
      capabilityId: fields.capabilityId,
      outputKind: fields.outputKind,
      messageRoles: fields.messageRoles ?? "system,user",
      taskRuleSource: fields.taskRuleSource ?? null,
      taskRuleHash: fields.taskRuleHash ?? null,
      episodeChars: fields.episodeChars,
      startedAt: fields.startedAt,
      finishedAt: fields.finishedAt,
      status: fields.status,
      errorCode: fields.errorCode ?? null,
    }),
  );
}

export type AssetPromptDiagStatus = "completed" | "failed" | "timeout";

export function logAssetPromptRequest(fields: {
  projectId: string;
  episodeId: string;
  itemId: string;
  assetName: string;
  generationId: string;
  capabilityId?: string;
  outputKind?: string;
  messageRoles?: string;
  taskRuleSource?: string | null;
  taskRuleHash?: string | null;
  providerModelId?: string | null;
  startedAt: string;
  finishedAt: string;
  status: AssetPromptDiagStatus;
  errorCode?: string | null;
}): void {
  console.info(
    JSON.stringify({
      event: "ASSET_PROMPT_REQUEST",
      projectId: fields.projectId,
      episodeId: fields.episodeId,
      itemId: fields.itemId,
      assetName: fields.assetName.slice(0, 64),
      generationId: fields.generationId,
      capabilityId: fields.capabilityId ?? "asset.design-prompt.generate",
      outputKind: fields.outputKind ?? "asset_design_prompt",
      messageRoles: fields.messageRoles ?? "system,user",
      taskRuleSource: fields.taskRuleSource ?? null,
      taskRuleHash: fields.taskRuleHash ?? null,
      providerModelId: fields.providerModelId ?? null,
      startedAt: fields.startedAt,
      finishedAt: fields.finishedAt,
      status: fields.status,
      errorCode: fields.errorCode ?? null,
    }),
  );
}

export function logAssetPromptBatch(fields: {
  episodeId: string;
  total: number;
  started: number;
  completed: number;
  failed: number;
  concurrency: number;
  batchSize?: number;
  requestConcurrency?: number;
  startedAt: string;
  finishedAt: string;
}): void {
  console.info(
    JSON.stringify({
      event: "ASSET_PROMPT_BATCH",
      episodeId: fields.episodeId,
      total: fields.total,
      started: fields.started,
      completed: fields.completed,
      failed: fields.failed,
      concurrency: fields.concurrency,
      batchSize: fields.batchSize ?? null,
      requestConcurrency: fields.requestConcurrency ?? null,
      startedAt: fields.startedAt,
      finishedAt: fields.finishedAt,
    }),
  );
}

export function logAssetPromptBatchRequest(fields: {
  projectId: string;
  episodeId: string;
  generationId: string;
  requestedAssetCount: number;
  completedAssetCount: number;
  failedAssetCount: number;
  batchSize: number;
  batchAttempt: number;
  finishReason?: string | null;
  truncated?: boolean;
  partialOutputChars?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  startedAt: string;
  finishedAt: string;
  status: AssetPromptDiagStatus;
  errorCode?: string | null;
}): void {
  console.info(
    JSON.stringify({
      event: "ASSET_PROMPT_BATCH_REQUEST",
      projectId: fields.projectId,
      episodeId: fields.episodeId,
      generationId: fields.generationId,
      requestedAssetCount: fields.requestedAssetCount,
      completedAssetCount: fields.completedAssetCount,
      failedAssetCount: fields.failedAssetCount,
      batchSize: fields.batchSize,
      batchAttempt: fields.batchAttempt,
      finishReason: fields.finishReason ?? null,
      truncated: fields.truncated ?? false,
      partialOutputChars: fields.partialOutputChars ?? 0,
      inputTokens: fields.inputTokens ?? null,
      outputTokens: fields.outputTokens ?? null,
      startedAt: fields.startedAt,
      finishedAt: fields.finishedAt,
      status: fields.status,
      errorCode: fields.errorCode ?? null,
    }),
  );
}

/** Mark stuck designPrompt.generating as failed after text-generation timeout + grace. */
export function reconcileStuckDesignPromptItems(
  record: EpisodeAssetDesignRecord,
  nowMs = Date.now(),
): { record: EpisodeAssetDesignRecord; changed: boolean } {
  const timeoutMs = resolveTimeoutMsForOutputKind("asset_design_prompt");
  const graceMs = 15_000;
  let changed = false;
  const items = record.items.map((item) => {
    const prompt = item.designPrompt;
    if (!prompt || prompt.status !== "generating") return item;
    const anchor = Date.parse(prompt.updatedAt ?? prompt.generatedAt ?? "");
    if (Number.isFinite(anchor) && nowMs - anchor <= timeoutMs + graceMs) {
      return item;
    }
    changed = true;
    const failed: AssetDesignPromptState = {
      ...prompt,
      status: "failed",
      text: "",
      errorMessage: prompt.errorMessage ?? "素材提示词生成超时",
      updatedAt: new Date(nowMs).toISOString(),
    };
    return { ...item, designPrompt: failed };
  });
  if (!changed) return { record, changed: false };
  return {
    changed: true,
    record: {
      ...record,
      items,
      updatedAt: new Date(nowMs).toISOString(),
    },
  };
}

export function countDesignPromptBatchProgress(
  items: Array<{ designPrompt?: { status?: string; text?: string } | null }>,
): { total: number; ready: number; failed: number; generating: number; missing: number } {
  let ready = 0;
  let failed = 0;
  let generating = 0;
  let missing = 0;
  for (const item of items) {
    const status = item.designPrompt?.status;
    const text = item.designPrompt?.text?.trim() ?? "";
    if (status === "ready" && text) {
      ready += 1;
      continue;
    }
    if (status === "generating") {
      generating += 1;
      continue;
    }
    if (status === "failed") {
      failed += 1;
      continue;
    }
    missing += 1;
  }
  return {
    total: items.length,
    ready,
    failed,
    generating,
    missing,
  };
}
