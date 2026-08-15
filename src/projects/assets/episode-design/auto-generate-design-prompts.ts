import type {
  AssetDesignPromptHistoryEntry,
  EpisodeAssetDesignItem,
} from "@/projects/assets/episode-design/types";
import {
  designPromptContentFingerprint,
  resolveFormalDesignPromptText,
} from "@/projects/assets/episode-design/format-design-draft-seed";
import {
  DEFAULT_DESIGN_PROMPT_MODEL_ID,
  type DesignPromptModelId,
} from "@/projects/assets/episode-design/design-prompt-models";
import {
  logAssetPromptBatch,
  resolveDesignPromptBatchConcurrency,
  resolveDesignPromptBatchRequestConcurrency,
  resolveDesignPromptBatchSize,
} from "@/projects/assets/episode-design/design-prompt-diagnostics";
import { resolveTimeoutMsForOutputKind } from "@/text-generation/generation-abort";

export function designPromptAutoGenKey(
  item: EpisodeAssetDesignItem,
  promptModelId: DesignPromptModelId = DEFAULT_DESIGN_PROMPT_MODEL_ID,
): string {
  return `${item.id}|${designPromptContentFingerprint(item)}|${promptModelId}`;
}

export function itemNeedsFormalDesignPrompt(
  item: EpisodeAssetDesignItem,
): boolean {
  return !resolveFormalDesignPromptText(item);
}

export function buildItemGeneratePromptUrl(input: {
  surface: "project_management" | "workspace";
  projectId: string;
  episodeId: string;
  itemId: string;
}): string {
  const enc = encodeURIComponent;
  if (input.surface === "workspace") {
    return `/api/workspace/projects/${enc(input.projectId)}/asset-designs/episodes/${enc(input.episodeId)}/items/${enc(input.itemId)}/generate-prompt`;
  }
  return `/api/projects/${enc(input.projectId)}/asset-designs/episodes/${enc(input.episodeId)}/items/${enc(input.itemId)}/generate-prompt`;
}

export function buildBatchGeneratePromptsUrl(input: {
  surface: "project_management" | "workspace";
  projectId: string;
  episodeId: string;
}): string {
  const enc = encodeURIComponent;
  if (input.surface === "workspace") {
    return `/api/workspace/projects/${enc(input.projectId)}/asset-designs/episodes/${enc(input.episodeId)}/generate-prompts`;
  }
  return `/api/projects/${enc(input.projectId)}/asset-designs/episodes/${enc(input.episodeId)}/generate-prompts`;
}

export type GenerateDesignPromptClientResult = {
  text: string;
  generationId: string | null;
  history: AssetDesignPromptHistoryEntry[];
  capabilityId?: string;
  outputKind?: string;
  status?: "ready" | "failed" | "timeout";
  errorCode?: string | null;
};

/**
 * Formal design-prompt generate (single asset). Never falls back to extract seed.
 * Kept for manual redesign / DesignAssetModal.
 */
export async function requestFormalDesignPromptGenerate(input: {
  surface: "project_management" | "workspace";
  projectId: string;
  episodeId: string;
  item: EpisodeAssetDesignItem;
  userRequirement?: string;
  promptModelId?: DesignPromptModelId;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<GenerateDesignPromptClientResult> {
  const promptModelId = input.promptModelId ?? DEFAULT_DESIGN_PROMPT_MODEL_ID;
  const url = buildItemGeneratePromptUrl({
    surface: input.surface,
    projectId: input.projectId,
    episodeId: input.episodeId,
    itemId: input.item.id,
  });
  const fingerprint = designPromptContentFingerprint(input.item);
  const idempotencyKey =
    input.idempotencyKey ??
    `prompt-auto-${input.item.id}-${fingerprint}-${promptModelId}`;

  const timeoutMs =
    input.timeoutMs ?? resolveTimeoutMsForOutputKind("asset_design_prompt");
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (input.signal?.aborted) {
    controller.abort();
  } else {
    input.signal?.addEventListener("abort", onAbort, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        idempotencyKey,
        userRequirement: input.userRequirement ?? "",
        promptModelId,
      }),
    });
    const payload = (await res.json()) as {
      error?: string;
      code?: string;
      prompt?: string;
      capabilityId?: string;
      outputKind?: string;
      designPrompt?: {
        text?: string;
        status?: string;
        history?: AssetDesignPromptHistoryEntry[];
        generationId?: string | null;
      };
    };
    if (!res.ok) {
      const err = new Error(payload.error ?? "提示词生成失败") as Error & {
        code?: string;
        timedOut?: boolean;
      };
      err.code = payload.code ?? "PROMPT_GENERATE_FAILED";
      throw err;
    }
    const text =
      payload.prompt?.trim() || payload.designPrompt?.text?.trim() || "";
    if (!text) {
      throw new Error("模型未返回有效的资产设计提示词");
    }
    return {
      text,
      generationId: payload.designPrompt?.generationId ?? null,
      history: payload.designPrompt?.history ?? [],
      capabilityId: payload.capabilityId,
      outputKind: payload.outputKind,
      status: "ready",
      errorCode: null,
    };
  } catch (error) {
    if (timedOut || (error instanceof DOMException && error.name === "AbortError")) {
      const err = new Error("素材提示词生成超时") as Error & {
        code?: string;
        timedOut?: boolean;
      };
      err.code = "MODEL_TIMEOUT";
      err.timedOut = true;
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
  }
}

export type BatchGenerateDesignPromptsClientResult = {
  generationId: string | null;
  requestedAssetIds: string[];
  completedAssetIds: string[];
  failedAssetIds: string[];
  nextAssetId: string;
  batchSize: number;
  items: Array<{
    itemId: string;
    status: "ready" | "failed";
    text: string;
    generationId: string | null;
    history: AssetDesignPromptHistoryEntry[];
    errorCode?: string;
    errorMessage?: string;
  }>;
  inputTokens?: number | null;
  outputTokens?: number | null;
  finishReason?: string | null;
  truncated?: boolean;
  partialOutputChars?: number;
  batchAttempts?: Array<{
    requestedAssetIds: string[];
    completedAssetIds: string[];
    batchSize: number;
    batchAttempt: number;
    inputTokens: number | null;
    outputTokens: number | null;
    finishReason: string | null;
    partialOutputChars: number;
    responseCompleted: boolean;
    truncated: boolean;
    errorCode?: string;
  }>;
};

export async function requestFormalDesignPromptBatchGenerate(input: {
  surface: "project_management" | "workspace";
  projectId: string;
  episodeId: string;
  items: EpisodeAssetDesignItem[];
  promptModelId?: DesignPromptModelId;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  retryMode?: "deferred" | "adaptive";
}): Promise<BatchGenerateDesignPromptsClientResult> {
  const promptModelId = input.promptModelId ?? DEFAULT_DESIGN_PROMPT_MODEL_ID;
  const url = buildBatchGeneratePromptsUrl({
    surface: input.surface,
    projectId: input.projectId,
    episodeId: input.episodeId,
  });
  const itemIds = input.items.map((item) => item.id);
  const fingerprint = input.items
    .map((item) => `${item.id}:${designPromptContentFingerprint(item)}`)
    .join("|");
  const idempotencyKey =
    input.idempotencyKey ??
    `prompt-batch-auto-${input.episodeId}-${fingerprint}-${promptModelId}-${input.retryMode ?? "adaptive"}`;

  const timeoutMs =
    input.timeoutMs ?? resolveTimeoutMsForOutputKind("asset_design_prompt");
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (input.signal?.aborted) {
    controller.abort();
  } else {
    input.signal?.addEventListener("abort", onAbort, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        idempotencyKey,
        itemIds,
        promptModelId,
        retryMode: input.retryMode ?? "adaptive",
      }),
    });
    const payload = (await res.json()) as BatchGenerateDesignPromptsClientResult & {
      error?: string;
      code?: string;
      ok?: boolean;
    };
    if (!res.ok && !(payload.completedAssetIds?.length > 0)) {
      const err = new Error(payload.error ?? "批量提示词生成失败") as Error & {
        code?: string;
        timedOut?: boolean;
      };
      err.code = payload.code ?? "PROMPT_GENERATE_FAILED";
      throw err;
    }
    return {
      generationId: payload.generationId ?? null,
      requestedAssetIds: payload.requestedAssetIds ?? itemIds,
      completedAssetIds: payload.completedAssetIds ?? [],
      failedAssetIds: payload.failedAssetIds ?? [],
      nextAssetId: payload.nextAssetId ?? "",
      batchSize: payload.batchSize ?? itemIds.length,
      items: payload.items ?? [],
      inputTokens: payload.inputTokens,
      outputTokens: payload.outputTokens,
      finishReason: payload.finishReason,
      truncated: payload.truncated,
      partialOutputChars: payload.partialOutputChars,
      batchAttempts: payload.batchAttempts,
    };
  } catch (error) {
    if (timedOut || (error instanceof DOMException && error.name === "AbortError")) {
      const err = new Error("素材提示词生成超时") as Error & {
        code?: string;
        timedOut?: boolean;
      };
      err.code = "MODEL_TIMEOUT";
      err.timedOut = true;
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
  }
}

export type AutoGeneratePromptProgress = {
  total: number;
  started: number;
  /** Number of unique assets whose current batch attempt has returned. */
  processed: number;
  completed: number;
  failed: number;
  concurrency: number;
  batchSize?: number;
  requestConcurrency?: number;
};

/**
 * After extract apply: generate formal prompts for items missing valid text.
 * Assets are chunked into model batches (default 5); each batch is one request.
 * Failures never abort sibling batches.
 */
export async function autoGenerateMissingFormalDesignPrompts(input: {
  surface: "project_management" | "workspace";
  projectId: string;
  episodeId: string;
  items: EpisodeAssetDesignItem[];
  promptModelId?: DesignPromptModelId;
  concurrency?: number;
  batchSize?: number;
  requestConcurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: AutoGeneratePromptProgress) => void;
  onItemStart?: (item: EpisodeAssetDesignItem) => void;
  onItemSuccess?: (
    item: EpisodeAssetDesignItem,
    result: GenerateDesignPromptClientResult,
  ) => void;
  onItemError?: (
    item: EpisodeAssetDesignItem,
    error: Error & { code?: string; timedOut?: boolean },
  ) => void;
}): Promise<{
  ok: number;
  failed: number;
  started: number;
  concurrency: number;
  batchSize: number;
  requestConcurrency: number;
}> {
  const targets = input.items.filter(itemNeedsFormalDesignPrompt);
  if (targets.length === 0) {
    return {
      ok: 0,
      failed: 0,
      started: 0,
      concurrency: 0,
      batchSize: 0,
      requestConcurrency: 0,
    };
  }

  // Legacy concurrency env kept for compatibility; batch path uses request concurrency.
  const legacyConcurrency = resolveDesignPromptBatchConcurrency(
    process.env,
    input.concurrency,
  );
  const batchSize = resolveDesignPromptBatchSize(process.env, input.batchSize);
  const requestConcurrency = resolveDesignPromptBatchRequestConcurrency(
    process.env,
    input.requestConcurrency,
  );
  const batchStartedAt = new Date().toISOString();

  const chunks: EpisodeAssetDesignItem[][] = [];
  for (let i = 0; i < targets.length; i += batchSize) {
    chunks.push(targets.slice(i, i + batchSize));
  }

  let ok = 0;
  let failed = 0;
  let started = 0;
  const processedIds = new Set<string>();
  let cursor = 0;
  const completedIds = new Set<string>();
  const deferredFailures = new Map<
    string,
    {
      item: EpisodeAssetDesignItem;
      error: Error & { code?: string; timedOut?: boolean };
    }
  >();

  const emitProgress = () => {
    input.onProgress?.({
      total: targets.length,
      started,
      processed: processedIds.size,
      completed: ok,
      failed,
      concurrency: legacyConcurrency,
      batchSize,
      requestConcurrency,
    });
  };

  function normalizeError(
    error: unknown,
  ): Error & { code?: string; timedOut?: boolean } {
    return error instanceof Error
      ? (error as Error & { code?: string; timedOut?: boolean })
      : Object.assign(new Error(String(error)), {
          code: "PROMPT_GENERATE_FAILED",
        });
  }

  async function processChunk(
    chunk: EpisodeAssetDesignItem[],
    phase: "initial" | "repair",
  ) {
    try {
      const result = await requestFormalDesignPromptBatchGenerate({
        surface: input.surface,
        projectId: input.projectId,
        episodeId: input.episodeId,
        items: chunk,
        promptModelId: input.promptModelId ?? DEFAULT_DESIGN_PROMPT_MODEL_ID,
        signal: input.signal,
        retryMode: phase === "initial" ? "deferred" : "adaptive",
      });

      const completedSet = new Set(result.completedAssetIds);
      const failedSet = new Set(result.failedAssetIds);
      const itemResultById = new Map(
        result.items.map((row) => [row.itemId, row]),
      );

      for (const item of chunk) processedIds.add(item.id);

      for (const item of chunk) {
        const row = itemResultById.get(item.id);
        if (completedSet.has(item.id) && row?.text) {
          deferredFailures.delete(item.id);
          if (completedIds.has(item.id)) continue;
          completedIds.add(item.id);
          ok += 1;
          input.onItemSuccess?.(item, {
            text: row.text,
            generationId: row.generationId,
            history: row.history,
            status: "ready",
            errorCode: null,
          });
          continue;
        }

        const itemError = new Error(
          row?.errorMessage ?? "素材提示词生成失败",
        ) as Error & { code?: string; timedOut?: boolean };
        itemError.code = row?.errorCode ?? "PROMPT_GENERATE_FAILED";
        if (failedSet.has(item.id) || result.truncated) {
          /* preserve the server error for the deferred repair pass */
        }
        if (phase === "initial") {
          deferredFailures.set(item.id, { item, error: itemError });
        } else {
          deferredFailures.delete(item.id);
          failed += 1;
          input.onItemError?.(item, itemError);
        }
      }
    } catch (error) {
      const normalized = normalizeError(error);
      for (const item of chunk) processedIds.add(item.id);
      for (const item of chunk) {
        if (phase === "initial") {
          deferredFailures.set(item.id, { item, error: normalized });
        } else {
          deferredFailures.delete(item.id);
          failed += 1;
          input.onItemError?.(item, normalized);
        }
      }
    } finally {
      emitProgress();
    }
  }

  async function initialWorker() {
    while (cursor < chunks.length) {
      if (input.signal?.aborted) return;
      const index = cursor;
      cursor += 1;
      const chunk = chunks[index]!;
      for (const item of chunk) {
        started += 1;
        input.onItemStart?.(item);
      }
      emitProgress();
      await processChunk(chunk, "initial");
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(requestConcurrency, chunks.length) },
      () => initialWorker(),
    ),
  );

  const repairTargets = [...deferredFailures.values()].map((row) => row.item);
  const repairChunks: EpisodeAssetDesignItem[][] = [];
  for (let i = 0; i < repairTargets.length; i += batchSize) {
    repairChunks.push(repairTargets.slice(i, i + batchSize));
  }

  let repairCursor = 0;
  async function repairWorker() {
    while (repairCursor < repairChunks.length) {
      if (input.signal?.aborted) return;
      const index = repairCursor;
      repairCursor += 1;
      await processChunk(repairChunks[index]!, "repair");
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(2, requestConcurrency, repairChunks.length) },
      () => repairWorker(),
    ),
  );

  for (const { item, error } of deferredFailures.values()) {
    failed += 1;
    input.onItemError?.(item, error);
  }
  deferredFailures.clear();
  emitProgress();

  const finishedAt = new Date().toISOString();
  logAssetPromptBatch({
    episodeId: input.episodeId,
    total: targets.length,
    started,
    completed: ok,
    failed,
    concurrency: legacyConcurrency,
    batchSize,
    requestConcurrency,
    startedAt: batchStartedAt,
    finishedAt,
  });

  return {
    ok,
    failed,
    started,
    concurrency: legacyConcurrency,
    batchSize,
    requestConcurrency,
  };
}
