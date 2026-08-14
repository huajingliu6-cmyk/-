import {
  buildCanonicalDto,
  enforceAssetLimits,
  mergeCanonicalAssets,
  type CanonicalAssetItem,
  type ParseAssetWarning,
  type RejectedAssetItem,
} from "@/projects/assets/episode-design/normalize-raw-asset";
import { parseEpisodeAssetDesignOutput } from "@/projects/assets/episode-design/parse-episode-asset-design";
import {
  SCRIPT_ASSET_MAP_CONCURRENCY,
  type ScriptAssetChunk,
} from "@/projects/assets/episode-design/script-asset-chunks";
import type { EpisodeAssetDesignGenerationDto } from "@/projects/assets/episode-design/schema";
import type { TextGenerationProvider } from "@/text-generation/provider/types";
import type { ProviderTextStreamEvent } from "@/text-generation/types";

export type ScriptAssetChunkResult = {
  chunkId: string;
  label: string;
  status: "completed" | "failed";
  content: string;
  errorCode?: string;
  errorMessage?: string;
  assetCount: number;
};

export type ScriptAssetMapReduceState = {
  version: 1;
  chunks: ScriptAssetChunkResult[];
  warnings: ParseAssetWarning[];
  rejectedItems: RejectedAssetItem[];
};

export type ScriptAssetMapReduceSuccess = {
  ok: true;
  content: string;
  dto: EpisodeAssetDesignGenerationDto;
  state: ScriptAssetMapReduceState;
  warnings: ParseAssetWarning[];
  rejectedItems: RejectedAssetItem[];
};

export type ScriptAssetMapReduceFailure = {
  ok: false;
  content: string;
  state: ScriptAssetMapReduceState;
  errorCode: string;
  errorMessage: string;
  warnings: ParseAssetWarning[];
  rejectedItems: RejectedAssetItem[];
};

async function collectProviderText(input: {
  provider: TextGenerationProvider;
  systemPrompt: string;
  userPrompt: string;
  providerModelId: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; text: string }
  | { ok: false; code: string; message: string }
> {
  let text = "";
  try {
    for await (const ev of input.provider.streamText({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      providerModelId: input.providerModelId,
      maxOutputTokens: input.maxOutputTokens,
      signal: input.signal,
    })) {
      if (ev.type === "delta") text += ev.text;
      else if (ev.type === "error") {
        return { ok: false, code: ev.code, message: ev.message };
      }
    }
  } catch (error) {
    if (input.signal?.aborted) {
      return { ok: false, code: "CANCELLED", message: "已取消" };
    }
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: error instanceof Error ? error.message : "分块调用失败",
    };
  }
  if (!text.trim()) {
    return { ok: false, code: "EMPTY_MODEL_OUTPUT", message: "分块模型输出为空" };
  }
  return { ok: true, text };
}

function buildUserPrompt(brief: string): string {
  return ["[UNTRUSTED_PROJECT_DATA]", brief].join("\n");
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index]!, index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function mergeChunkDtos(
  chunkResults: ScriptAssetChunkResult[],
): {
  assets: CanonicalAssetItem[];
  warnings: ParseAssetWarning[];
  rejectedItems: RejectedAssetItem[];
} {
  const warnings: ParseAssetWarning[] = [];
  const rejectedItems: RejectedAssetItem[] = [];
  const assets: CanonicalAssetItem[] = [];

  for (const chunk of chunkResults) {
    if (chunk.status !== "completed" || !chunk.content.trim()) continue;
    const parsed = parseEpisodeAssetDesignOutput(chunk.content);
    if (!parsed.ok) {
      warnings.push({
        code: "CHUNK_PARSE_SOFT_FAIL",
        message: `分块 ${chunk.label} 解析失败：${parsed.message}`,
      });
      rejectedItems.push(
        ...(parsed.rejectedItems ?? []).map((r) => ({
          ...r,
          reason: `[${chunk.label}] ${r.reason}`,
        })),
      );
      continue;
    }
    warnings.push(
      ...parsed.warnings.map((w) => ({
        ...w,
        message: `[${chunk.label}] ${w.message}`,
      })),
    );
    rejectedItems.push(
      ...parsed.rejectedItems.map((r) => ({
        ...r,
        reason: `[${chunk.label}] ${r.reason}`,
      })),
    );
    assets.push(...parsed.value.assets);
  }

  const merged = mergeCanonicalAssets(assets);
  warnings.push(...merged.warnings);
  const limited = enforceAssetLimits(merged.assets);
  warnings.push(...limited.warnings);
  return { assets: limited.assets, warnings, rejectedItems };
}

/**
 * Run map-reduce over script chunks. Retries only chunks listed in `onlyChunkIds`
 * when provided; successful chunks in `previousState` are reused.
 */
export async function runScriptAssetMapReduce(input: {
  chunks: ScriptAssetChunk[];
  provider: TextGenerationProvider;
  systemPrompt: string;
  providerModelId: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
  previousState?: ScriptAssetMapReduceState | null;
  onlyChunkIds?: string[];
  onChunkComplete?: (chunk: ScriptAssetChunkResult) => void;
}): Promise<ScriptAssetMapReduceSuccess | ScriptAssetMapReduceFailure> {
  const previousById = new Map(
    (input.previousState?.chunks ?? []).map((c) => [c.chunkId, c]),
  );
  const only = input.onlyChunkIds ? new Set(input.onlyChunkIds) : null;

  const pending = input.chunks.filter((chunk) => {
    if (only && !only.has(chunk.chunkId)) return false;
    const prev = previousById.get(chunk.chunkId);
    if (!only && prev?.status === "completed" && prev.content.trim()) {
      return false;
    }
    return true;
  });

  const freshResults = await mapPool(
    pending,
    SCRIPT_ASSET_MAP_CONCURRENCY,
    async (chunk) => {
      if (input.signal?.aborted) {
        const failed: ScriptAssetChunkResult = {
          chunkId: chunk.chunkId,
          label: chunk.label,
          status: "failed",
          content: "",
          errorCode: "CANCELLED",
          errorMessage: "已取消",
          assetCount: 0,
        };
        input.onChunkComplete?.(failed);
        return failed;
      }
      const collected = await collectProviderText({
        provider: input.provider,
        systemPrompt: input.systemPrompt,
        userPrompt: buildUserPrompt(chunk.brief),
        providerModelId: input.providerModelId,
        maxOutputTokens: input.maxOutputTokens,
        signal: input.signal,
      });
      if (!collected.ok) {
        const failed: ScriptAssetChunkResult = {
          chunkId: chunk.chunkId,
          label: chunk.label,
          status: "failed",
          content: "",
          errorCode: collected.code,
          errorMessage: collected.message,
          assetCount: 0,
        };
        input.onChunkComplete?.(failed);
        return failed;
      }
      // One per-chunk retry on empty/invalid soft failure is handled by caller;
      // here we parse for assetCount diagnostics only.
      const parsed = parseEpisodeAssetDesignOutput(collected.text);
      const result: ScriptAssetChunkResult = {
        chunkId: chunk.chunkId,
        label: chunk.label,
        status: parsed.ok ? "completed" : "failed",
        content: collected.text,
        errorCode: parsed.ok ? undefined : parsed.code,
        errorMessage: parsed.ok ? undefined : parsed.message,
        assetCount: parsed.ok ? parsed.value.assets.length : 0,
      };
      // Keep raw content even when parse fails so format repair / re-apply can use it.
      if (!parsed.ok && collected.text.trim()) {
        result.status = "completed";
        result.errorCode = undefined;
        result.errorMessage = undefined;
      }
      input.onChunkComplete?.(result);
      return result;
    },
  );

  const freshById = new Map(freshResults.map((r) => [r.chunkId, r]));
  const combined: ScriptAssetChunkResult[] = input.chunks.map((chunk) => {
    const fresh = freshById.get(chunk.chunkId);
    if (fresh) return fresh;
    const prev = previousById.get(chunk.chunkId);
    if (prev) return prev;
    return {
      chunkId: chunk.chunkId,
      label: chunk.label,
      status: "failed",
      content: "",
      errorCode: "CHUNK_SKIPPED",
      errorMessage: "分块未执行",
      assetCount: 0,
    };
  });

  const failed = combined.filter((c) => c.status === "failed");
  const merged = mergeChunkDtos(combined);
  const state: ScriptAssetMapReduceState = {
    version: 1,
    chunks: combined,
    warnings: merged.warnings,
    rejectedItems: merged.rejectedItems,
  };

  if (merged.assets.length === 0) {
    return {
      ok: false,
      content: JSON.stringify({ version: 1, assets: [], mapReduce: state }),
      state,
      errorCode: failed[0]?.errorCode ?? "EPISODE_ASSET_DESIGN_CONTENT_EMPTY",
      errorMessage:
        failed.length > 0
          ? `全部分块失败或无有效资产（失败 ${failed.length} 块）`
          : "没有有效资产",
      warnings: merged.warnings,
      rejectedItems: merged.rejectedItems,
    };
  }

  const dto = buildCanonicalDto(merged.assets);
  const content = JSON.stringify(dto);
  if (failed.length > 0) {
    // Partial success: still return ok with warnings so UI can show assets + retry failed chunks.
    state.warnings = [
      ...merged.warnings,
      {
        code: "PARTIAL_CHUNKS_FAILED",
        message: `${failed.length} 个分块失败，可重试失败分块`,
      },
    ];
  }

  return {
    ok: true,
    content,
    dto,
    state,
    warnings: state.warnings,
    rejectedItems: merged.rejectedItems,
  };
}

/** Encode map-reduce diagnostics into a safe job sidecar payload (no secrets). */
export function serializeMapReduceState(
  state: ScriptAssetMapReduceState,
): string {
  return JSON.stringify({
    version: state.version,
    chunks: state.chunks.map((c) => ({
      chunkId: c.chunkId,
      label: c.label,
      status: c.status,
      assetCount: c.assetCount,
      errorCode: c.errorCode ?? null,
      errorMessage: c.errorMessage ?? null,
      // Keep content for completed chunks so retry can skip re-billing them.
      content: c.status === "completed" ? c.content : "",
    })),
    warnings: state.warnings.slice(0, 50),
    rejectedItems: state.rejectedItems.slice(0, 50),
  });
}

export function parseMapReduceState(
  raw: string | null | undefined,
): ScriptAssetMapReduceState | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as ScriptAssetMapReduceState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.chunks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Silence unused type import in some TS configs
export type _ProviderEv = ProviderTextStreamEvent;
