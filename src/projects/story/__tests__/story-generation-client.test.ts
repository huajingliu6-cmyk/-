import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelStoryGeneration,
  createScriptOutlineIdempotencyKey,
  streamStoryGeneration,
  StoryGenerationClientError,
} from "@/projects/story/story-generation-client";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("story-generation-client script_outline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("createScriptOutlineIdempotencyKey prefixes outline_", () => {
    expect(createScriptOutlineIdempotencyKey()).toMatch(/^outline_/);
  });

  it("streams meta delta usage done for script_outline", async () => {
    const deltas: string[] = [];
    let metaId = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          outputKind?: string;
        };
        expect(body.outputKind).toBe("script_outline");
        return streamResponse([
          sse("meta", {
            generationId: "gen_ol_1",
            displayModelName: "Mock",
            reservedPoints: 2,
          }),
          sse("delta", { text: "【故事核心】" }),
          sse("delta", { text: "雨夜" }),
          sse("usage", { chargedPoints: 2, actualChars: 8 }),
          sse("done", { generationId: "gen_ol_1" }),
        ]);
      }),
    );

    const result = await streamStoryGeneration({
      projectId: "p1",
      brief: "材料",
      modelKey: "balanced-default",
      targetChars: 500,
      idempotencyKey: "outline_k1",
      outputKind: "script_outline",
      onMeta: (m) => {
        metaId = m.generationId;
      },
      onDelta: (t) => {
        deltas.push(t);
      },
    });

    expect(metaId).toBe("gen_ol_1");
    expect(deltas).toEqual(["【故事核心】", "【故事核心】雨夜"]);
    expect(result.text).toBe("【故事核心】雨夜");
    expect(result.chargedPoints).toBe(2);
    expect(result.actualChars).toBe(8);
  });

  it("rejects on SSE error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          sse("error", {
            code: "INSUFFICIENT_CREDITS",
            message: "积分不足",
          }),
        ]),
      ),
    );
    await expect(
      streamStoryGeneration({
        projectId: "p1",
        brief: "x",
        modelKey: "balanced-default",
        targetChars: 200,
        idempotencyKey: "outline_err",
        outputKind: "script_outline",
      }),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDITS",
      message: "积分不足",
    } satisfies Partial<StoryGenerationClientError>);
  });

  it("fails safely on incomplete stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([sse("delta", { text: "半截" })]),
      ),
    );
    await expect(
      streamStoryGeneration({
        projectId: "p1",
        brief: "x",
        modelKey: "balanced-default",
        targetChars: 200,
        idempotencyKey: "outline_inc",
        outputKind: "script_outline",
      }),
    ).rejects.toMatchObject({ code: "INCOMPLETE" });
  });

  it("defaults outputKind to story when omitted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          outputKind?: string;
        };
        expect(body.outputKind).toBe("story");
        return streamResponse([
          sse("meta", { generationId: "g" }),
          sse("delta", { text: "故事" }),
          sse("done", { generationId: "g" }),
        ]);
      }),
    );
    const result = await streamStoryGeneration({
      projectId: "p1",
      brief: "x",
      modelKey: "balanced-default",
      targetChars: 200,
      idempotencyKey: "story_k",
    });
    expect(result.text).toBe("故事");
  });

  it("cancelStoryGeneration posts cancel route", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await cancelStoryGeneration("proj", "gen_x");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/proj/text-generations/gen_x/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
