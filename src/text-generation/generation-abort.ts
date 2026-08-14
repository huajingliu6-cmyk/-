import type { TextOutputKind } from "@/text-generation/types";

const DEFAULT_TEXT_GENERATION_TIMEOUT_MS = 170_000;
const MIN_TEXT_GENERATION_TIMEOUT_MS = 30_000;
const MAX_TEXT_GENERATION_TIMEOUT_MS = 600_000;

const DEFAULT_SCRIPT_ASSET_DESIGN_TIMEOUT_MS = 600_000;
const MIN_SCRIPT_ASSET_DESIGN_TIMEOUT_MS = 60_000;
const MAX_SCRIPT_ASSET_DESIGN_TIMEOUT_MS = 1_200_000;

function clampTimeoutMs(
  parsed: number,
  fallback: number,
  minMs: number,
  maxMs: number,
): number {
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maxMs, Math.max(minMs, Math.trunc(parsed)));
}

/** Default timeout for ordinary text generation jobs (not full-script extract). */
export function resolveTextGenerationTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(env.TEXT_GENERATION_TIMEOUT_MS);
  return clampTimeoutMs(
    parsed,
    DEFAULT_TEXT_GENERATION_TIMEOUT_MS,
    MIN_TEXT_GENERATION_TIMEOUT_MS,
    MAX_TEXT_GENERATION_TIMEOUT_MS,
  );
}

/** Full-script asset extract (`script_asset_design`) — longer default, own env override. */
export function resolveScriptAssetDesignTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(env.SCRIPT_ASSET_DESIGN_TIMEOUT_MS);
  return clampTimeoutMs(
    parsed,
    DEFAULT_SCRIPT_ASSET_DESIGN_TIMEOUT_MS,
    MIN_SCRIPT_ASSET_DESIGN_TIMEOUT_MS,
    MAX_SCRIPT_ASSET_DESIGN_TIMEOUT_MS,
  );
}

export function resolveTimeoutMsForOutputKind(
  outputKind: TextOutputKind | string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): number {
  if (outputKind === "script_asset_design") {
    return resolveScriptAssetDesignTimeoutMs(env);
  }
  return resolveTextGenerationTimeoutMs(env);
}

export function createTextGenerationAbortScope(
  upstreamSignal?: AbortSignal,
  timeoutMs = resolveTextGenerationTimeoutMs(),
) {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) {
    abortFromUpstream();
  } else {
    upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    didTimeout: () => timedOut,
    timeoutMs,
    dispose: () => {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    },
  };
}
