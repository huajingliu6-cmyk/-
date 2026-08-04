const DEFAULT_TEXT_GENERATION_TIMEOUT_MS = 170_000;
const MIN_TEXT_GENERATION_TIMEOUT_MS = 30_000;
const MAX_TEXT_GENERATION_TIMEOUT_MS = 600_000;

export function resolveTextGenerationTimeoutMs(
  env: Pick<NodeJS.ProcessEnv, "TEXT_GENERATION_TIMEOUT_MS"> = process.env,
): number {
  const parsed = Number(env.TEXT_GENERATION_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TEXT_GENERATION_TIMEOUT_MS;
  return Math.min(
    MAX_TEXT_GENERATION_TIMEOUT_MS,
    Math.max(MIN_TEXT_GENERATION_TIMEOUT_MS, Math.trunc(parsed)),
  );
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
    dispose: () => {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    },
  };
}
