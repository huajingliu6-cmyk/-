import { describe, expect, it, vi, afterEach } from "vitest";
import { HttpCompatibleTextProvider } from "@/text-generation/provider/http-compatible-provider";

function sseChunk(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function readableFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]!);
      index += 1;
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HttpCompatibleTextProvider true streaming", () => {
  it("yields the first delta before the upstream stream closes", async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const secondGate = new Promise<void>((resolve) => {
      gate.release = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        let step = 0;
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            step += 1;
            if (step === 1) {
              controller.enqueue(
                sseChunk({
                  choices: [{ delta: { content: "第一部分" } }],
                }),
              );
              return;
            }
            if (step === 2) {
              await secondGate;
              controller.enqueue(
                sseChunk({
                  choices: [{ delta: { content: "第二部分" } }],
                }),
              );
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              controller.close();
            }
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    const provider = new HttpCompatibleTextProvider(
      "sk-test",
      "https://api.deepseek.com/v1",
      "deepseek-v4-pro",
    );
    const gen = provider.streamText({
      systemPrompt: "sys",
      userPrompt: "user",
      providerModelId: "deepseek-v4-pro",
      maxOutputTokens: 1000,
    });

    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ type: "delta", text: "第一部分" });

    gate.release?.();
    const rest: string[] = [];
    for await (const ev of gen) {
      if (ev.type === "delta") rest.push(ev.text);
    }
    expect(rest).toEqual(["第二部分"]);
  });

  it("forwards multiple SSE deltas in order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = readableFromChunks([
          sseChunk({ choices: [{ delta: { content: "A" } }] }),
          sseChunk({ choices: [{ delta: { content: "B" } }] }),
          sseChunk({
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 3, completion_tokens: 2 },
          }),
          new TextEncoder().encode("data: [DONE]\n\n"),
        ]);
        return new Response(body, { status: 200 });
      }),
    );

    const provider = new HttpCompatibleTextProvider(
      "sk-test",
      "https://api.deepseek.com/v1",
      "deepseek-v4-pro",
    );
    const deltas: string[] = [];
    for await (const ev of provider.streamText({
      systemPrompt: "s",
      userPrompt: "u",
      providerModelId: "deepseek-v4-pro",
      maxOutputTokens: 100,
    })) {
      if (ev.type === "delta") deltas.push(ev.text);
    }
    expect(deltas).toEqual(["A", "B"]);
  });

  it("does not non-stream fallback after partial body was received", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const bodyText = typeof init?.body === "string" ? init.body : "";
      if (bodyText.includes('"stream":false')) {
        throw new Error("fallback should not run");
      }
      const body = readableFromChunks([
        sseChunk({ choices: [{ delta: { content: "已有正文" } }] }),
        new TextEncoder().encode("data: [DONE]\n\n"),
      ]);
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new HttpCompatibleTextProvider(
      "sk-test",
      "https://api.deepseek.com/v1",
      "deepseek-v4-pro",
    );
    const events = [];
    for await (const ev of provider.streamText({
      systemPrompt: "s",
      userPrompt: "u",
      providerModelId: "deepseek-v4-pro",
      maxOutputTokens: 100,
    })) {
      events.push(ev);
    }
    expect(events.some((e) => e.type === "delta" && e.text === "已有正文")).toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to non-stream once when the stream yields no text", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const bodyText = typeof init?.body === "string" ? init.body : "";
      if (bodyText.includes('"stream":false')) {
        return Response.json({
          choices: [{ message: { content: "非流式正文" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
        });
      }
      const body = readableFromChunks([
        sseChunk({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        new TextEncoder().encode("data: [DONE]\n\n"),
      ]);
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new HttpCompatibleTextProvider(
      "sk-test",
      "https://api.deepseek.com/v1",
      "deepseek-v4-pro",
    );
    const deltas: string[] = [];
    for await (const ev of provider.streamText({
      systemPrompt: "s",
      userPrompt: "u",
      providerModelId: "deepseek-v4-pro",
      maxOutputTokens: 100,
    })) {
      if (ev.type === "delta") deltas.push(ev.text);
    }
    expect(deltas).toEqual(["非流式正文"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps AbortSignal abort to CANCELLED", async () => {
    const upstream = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
        return new Response(null, { status: 500 });
      }),
    );

    const provider = new HttpCompatibleTextProvider(
      "sk-test",
      "https://api.deepseek.com/v1",
      "deepseek-v4-pro",
    );
    const gen = provider.streamText({
      systemPrompt: "s",
      userPrompt: "u",
      providerModelId: "deepseek-v4-pro",
      maxOutputTokens: 100,
      signal: upstream.signal,
    });
    const pending = gen.next();
    upstream.abort();
    const first = await pending;
    expect(first.value).toMatchObject({
      type: "error",
      code: "CANCELLED",
    });
  });
});
