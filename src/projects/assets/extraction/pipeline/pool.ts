import type { TextGenerationProvider } from "@/text-generation/provider/types";

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(items.length, 1)) },
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

export async function collectProviderText(input: {
  provider: TextGenerationProvider;
  systemPrompt: string;
  userPrompt: string;
  providerModelId: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
  /** Hard timeout for the whole stream; returns MODEL_TIMEOUT when exceeded. */
  timeoutMs?: number;
  /** Optional heartbeat while the stream is open. */
  onTick?: () => void | Promise<void>;
  tickMs?: number;
}): Promise<
  | { ok: true; text: string }
  | { ok: false; code: string; message: string }
> {
  let text = "";
  const timeoutMs =
    typeof input.timeoutMs === "number" && input.timeoutMs > 0
      ? input.timeoutMs
      : 0;
  const tickMs =
    typeof input.tickMs === "number" && input.tickMs > 0
      ? input.tickMs
      : 12_000;
  const timeoutController = timeoutMs > 0 ? new AbortController() : null;
  const tickTimer =
    input.onTick != null
      ? setInterval(() => {
          void Promise.resolve(input.onTick?.()).catch(() => undefined);
        }, tickMs)
      : null;

  const signals = [input.signal, timeoutController?.signal].filter(
    (value): value is AbortSignal => Boolean(value),
  );
  const signal =
    signals.length === 0
      ? undefined
      : signals.length === 1
        ? signals[0]
        : AbortSignal.any(signals);

  const consume = async (): Promise<
    | { ok: true; text: string }
    | { ok: false; code: string; message: string }
  > => {
    try {
      for await (const ev of input.provider.streamText({
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        providerModelId: input.providerModelId,
        maxOutputTokens: input.maxOutputTokens,
        signal,
      })) {
        if (timeoutController?.signal.aborted && !input.signal?.aborted) {
          return {
            ok: false,
            code: "MODEL_TIMEOUT",
            message: "模型请求超时",
          };
        }
        if (ev.type === "delta") text += ev.text;
        else if (ev.type === "error") {
          return { ok: false, code: ev.code, message: ev.message };
        }
      }
    } catch (error) {
      if (timeoutController?.signal.aborted && !input.signal?.aborted) {
        return {
          ok: false,
          code: "MODEL_TIMEOUT",
          message: "模型请求超时",
        };
      }
      if (input.signal?.aborted || signal?.aborted) {
        return { ok: false, code: "CANCELLED", message: "已取消" };
      }
      return {
        ok: false,
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "模型调用失败",
      };
    }
    if (!text.trim()) {
      return { ok: false, code: "EMPTY_MODEL_OUTPUT", message: "模型输出为空" };
    }
    return { ok: true, text };
  };

  try {
    if (timeoutMs <= 0) {
      return await consume();
    }

    let settled = false;
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        timeoutController?.abort();
        if (settled) return;
        settled = true;
        resolve({
          ok: false,
          code: "MODEL_TIMEOUT",
          message: "模型请求超时",
        });
      }, timeoutMs);

      void consume().then((result) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve(result);
      });
    });
  } finally {
    if (tickTimer) clearInterval(tickTimer);
  }
}
