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
      message: error instanceof Error ? error.message : "模型调用失败",
    };
  }
  if (!text.trim()) {
    return { ok: false, code: "EMPTY_MODEL_OUTPUT", message: "模型输出为空" };
  }
  return { ok: true, text };
}
