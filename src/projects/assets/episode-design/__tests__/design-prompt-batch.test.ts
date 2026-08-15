import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createDesignPromptBatchNdjsonState,
  finalizeDesignPromptBatchNdjson,
  halfBatchSize,
  nextIncompleteAssetId,
  pushDesignPromptBatchNdjsonChunk,
} from "@/projects/assets/episode-design/parse-design-prompt-batch-ndjson";
import {
  buildDesignPromptBatchUserPayload,
  streamBatchDesignPrompts,
} from "@/projects/assets/episode-design/generate-design-prompt-batch";
import {
  assertValidDesignPromptText,
  MIN_FORMAL_DESIGN_PROMPT_VISIBLE_CHARS,
} from "@/projects/assets/episode-design/generate-design-prompt";
import {
  resolveDesignPromptBatchRequestConcurrency,
  resolveDesignPromptBatchSize,
} from "@/projects/assets/episode-design/design-prompt-diagnostics";
import {
  autoGenerateMissingFormalDesignPrompts,
  itemNeedsFormalDesignPrompt,
} from "@/projects/assets/episode-design/auto-generate-design-prompts";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import type { TextGenerationProvider } from "@/text-generation/provider/types";
import { HttpCompatibleTextProvider } from "@/text-generation/provider/http-compatible-provider";
import * as projectAccess from "@/projects/project-access";
import * as aiResolve from "@/ai-config/resolve";
import * as executionPlan from "@/ai-config/execution-plan";

const LONG_PROMPT =
  "横构图电影剧照，虚构青年律师立于法庭中央，短发深色瞳孔，深灰西装，冷硬侧光，写实影视摄影质感，精细服装材质与真实皮肤细节，浅景深构图，电影级灯光，16:9画幅，可直接用于素材生成的完整连贯中文提示词正文。";

function makeItem(id: string): EpisodeAssetDesignItem {
  return {
    id,
    assetType: "character",
    name: `角色${id}`,
    resolution: "create_new",
    source: "extract",
    draft: {
      description: "女主",
      appearance: "短发",
      clothing: "青衫",
      role: "主角",
      age: "28",
      voiceId: null,
      voiceName: null,
      voiceBound: false,
      usageInEpisode: "开场",
      evidence: "第一场",
    },
  } as unknown as EpisodeAssetDesignItem;
}

function extractBatchAssetIds(userPrompt: string): string[] {
  const dataMatch = /<DATA[^>]*>\n?([\s\S]*?)\n?<\/DATA>/.exec(userPrompt);
  const raw = dataMatch?.[1] ?? userPrompt;
  const marker = '"assets":';
  const idx = raw.indexOf(marker);
  if (idx < 0) return [];
  // Walk backward to the enclosing payload object that contains assets.
  const start = raw.lastIndexOf("{", idx);
  if (start < 0) return [];
  try {
    const parsed = JSON.parse(raw.slice(start)) as {
      assets?: Array<{ asset_id?: string }>;
    };
    return (parsed.assets ?? [])
      .map((a) => a.asset_id?.trim() ?? "")
      .filter(Boolean);
  } catch {
    return [
      ...raw.slice(idx).matchAll(/"asset_id"\s*:\s*"([^"]+)"/g),
    ]
      .map((m) => m[1]!)
      .filter((id) => id !== "<请求中的asset_id>");
  }
}

function formalPromptFor(id: string): string {
  return `${LONG_PROMPT}资产标识${id}。`;
}

function stubBatchDeps() {
  vi.spyOn(projectAccess, "getProjectRecord").mockResolvedValue({
    visualStyle: "live_action_cinematic",
    highlights: "",
  } as never);
  vi.spyOn(aiResolve, "resolveCapabilityForOutputKind").mockResolvedValue({
    profile: { provider: "mock", apiUrl: "", model: "mock" },
    secret: null,
  } as never);
  vi.spyOn(executionPlan, "resolveAiExecutionPlan").mockResolvedValue({
    systemPrompt: "[ADMIN_PUBLISHED_TASK_RULE]\nbatch ndjson",
    taskRule: { source: "builtin", version: 1, contentHash: "h1" },
    modelConnection: { id: "mc1" },
    systemPolicyVersion: "1",
    outputContractVersion: "1",
    inputFingerprint: "fp",
  } as never);
}

describe("design prompt batch size config", () => {
  it("defaults batch size to 5 and rejects out-of-range", () => {
    expect(resolveDesignPromptBatchSize({})).toBe(5);
    expect(resolveDesignPromptBatchSize({ DESIGN_PROMPT_BATCH_SIZE: "3" })).toBe(3);
    expect(resolveDesignPromptBatchSize({ DESIGN_PROMPT_BATCH_SIZE: "0" })).toBe(5);
    expect(resolveDesignPromptBatchSize({ DESIGN_PROMPT_BATCH_SIZE: "11" })).toBe(5);
    expect(resolveDesignPromptBatchSize({}, 7)).toBe(7);
  });

  it("defaults request concurrency to 3 and accepts 2-5", () => {
    expect(resolveDesignPromptBatchRequestConcurrency({})).toBe(3);
    expect(
      resolveDesignPromptBatchRequestConcurrency({
        DESIGN_PROMPT_BATCH_REQUEST_CONCURRENCY: "2",
      }),
    ).toBe(2);
    expect(
      resolveDesignPromptBatchRequestConcurrency({
        DESIGN_PROMPT_BATCH_REQUEST_CONCURRENCY: "5",
      }),
    ).toBe(5);
    expect(
      resolveDesignPromptBatchRequestConcurrency({
        DESIGN_PROMPT_BATCH_REQUEST_CONCURRENCY: "1",
      }),
    ).toBe(3);
    expect(
      resolveDesignPromptBatchRequestConcurrency({
        DESIGN_PROMPT_BATCH_REQUEST_CONCURRENCY: "9",
      }),
    ).toBe(3);
  });

  it("halfBatchSize shrinks toward 1", () => {
    expect(halfBatchSize(4, 5)).toBe(2);
    expect(halfBatchSize(2, 2)).toBe(1);
    expect(halfBatchSize(1, 1)).toBe(1);
  });
});

describe("NDJSON incremental parse", () => {
  it("parses 5 asset lines and batch_end", () => {
    const ids = ["a1", "a2", "a3", "a4", "a5"];
    const allowed = new Set(ids);
    const state = createDesignPromptBatchNdjsonState();
    const body =
      ids
        .map((id) =>
          JSON.stringify({
            type: "asset",
            asset_id: id,
            prompt: formalPromptFor(id),
            status: "completed",
          }),
        )
        .join("\n") +
      "\n" +
      JSON.stringify({
        type: "batch_end",
        completed_asset_ids: ids,
        failed_asset_ids: [],
        next_asset_id: "",
      });

    for (let i = 0; i < body.length; i += 37) {
      pushDesignPromptBatchNdjsonChunk(state, body.slice(i, i + 37), allowed);
    }
    finalizeDesignPromptBatchNdjson(state, allowed);
    expect(state.completed.size).toBe(5);
    expect(state.sawBatchEnd).toBe(true);
  });

  it("keeps 3 complete assets when truncated mid-batch", () => {
    const ids = ["a1", "a2", "a3", "a4", "a5"];
    const allowed = new Set(ids);
    const state = createDesignPromptBatchNdjsonState();
    const lines = ids.slice(0, 3).map((id) =>
      JSON.stringify({
        type: "asset",
        asset_id: id,
        prompt: formalPromptFor(id),
        status: "completed",
      }),
    );
    pushDesignPromptBatchNdjsonChunk(
      state,
      lines.join("\n") +
        "\n{\"type\":\"asset\",\"asset_id\":\"a4\",\"prompt\":\"截断",
      allowed,
    );
    finalizeDesignPromptBatchNdjson(state, allowed);
    expect([...state.completed.keys()]).toEqual(["a1", "a2", "a3"]);
    expect(nextIncompleteAssetId(ids, new Set(state.completed.keys()))).toBe(
      "a4",
    );
  });

  it("does not count incomplete final JSON line", () => {
    const allowed = new Set(["a1"]);
    const state = createDesignPromptBatchNdjsonState();
    pushDesignPromptBatchNdjsonChunk(
      state,
      '{"type":"asset","asset_id":"a1","prompt":"未完成',
      allowed,
    );
    const finalized = finalizeDesignPromptBatchNdjson(state, allowed);
    expect(state.completed.size).toBe(0);
    expect(finalized.rejected[0]?.reason).toBe("incomplete_line");
  });

  it("rejects unknown asset_id and ignores duplicate asset_id", () => {
    const allowed = new Set(["a1"]);
    const state = createDesignPromptBatchNdjsonState();
    const line1 = JSON.stringify({
      type: "asset",
      asset_id: "a1",
      prompt: formalPromptFor("a1"),
      status: "completed",
    });
    const dup = JSON.stringify({
      type: "asset",
      asset_id: "a1",
      prompt: formalPromptFor("dup"),
      status: "completed",
    });
    const unknown = JSON.stringify({
      type: "asset",
      asset_id: "zzz",
      prompt: formalPromptFor("zzz"),
      status: "completed",
    });
    const pushed = pushDesignPromptBatchNdjsonChunk(
      state,
      `${line1}\n${dup}\n${unknown}\n`,
      allowed,
    );
    expect(state.completed.size).toBe(1);
    expect(state.completed.get("a1")?.prompt).toContain("a1");
    expect(pushed.rejected.some((r) => r.reason === "unknown_asset_id")).toBe(
      true,
    );
  });

  it("keeps valid sibling when one asset line is format-invalid", () => {
    const allowed = new Set(["a1", "a2"]);
    const state = createDesignPromptBatchNdjsonState();
    const good = JSON.stringify({
      type: "asset",
      asset_id: "a1",
      prompt: formalPromptFor("a1"),
      status: "completed",
    });
    const bad = JSON.stringify({
      type: "asset",
      asset_id: "a2",
      prompt: "",
      status: "completed",
    });
    pushDesignPromptBatchNdjsonChunk(state, `${good}\n${bad}\n`, allowed);
    expect([...state.completed.keys()]).toEqual(["a1"]);
  });
});

describe("formal prompt min length", () => {
  it("rejects prompts shorter than 100 visible chars", () => {
    expect(MIN_FORMAL_DESIGN_PROMPT_VISIBLE_CHARS).toBe(100);
    expect(() =>
      assertValidDesignPromptText("只有两个字", makeItem("x")),
    ).toThrow(/过短/);
  });

  it("accepts long formal Chinese prompts", () => {
    expect(
      assertValidDesignPromptText(LONG_PROMPT, makeItem("x")).length,
    ).toBeGreaterThanOrEqual(100);
  });
});

describe("batch user payload", () => {
  it("sends episode_context and style once with ndjson contract", () => {
    const { payload, text } = buildDesignPromptBatchUserPayload({
      taskId: "t1",
      items: [{ item: makeItem("a1") }, { item: makeItem("a2") }],
      episodeText: "本集正文".repeat(1000),
      projectVisualStyle: "真人电影级写实",
    });
    expect(payload.output_contract).toBe("ndjson");
    expect(payload.episode_context).toBeDefined();
    expect(String(payload.episode_context).length).toBeLessThanOrEqual(2400);
    expect(payload.project_visual_style).toBe("真人电影级写实");
    expect((payload.assets as unknown[]).length).toBe(2);
    expect(text).toContain("output_contract");
    expect(text).not.toContain("assistant");
  });
});

describe("HttpCompatible finish_reason with partial body", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports finish_reason=length even when partial text arrived", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: "部分正文内容" } }] })}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  choices: [{ delta: {}, finish_reason: "length" }],
                  usage: { prompt_tokens: 10, completion_tokens: 20 },
                })}\n\n`,
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(body, { status: 200 });
      }),
    );

    const provider = new HttpCompatibleTextProvider(
      "sk-test",
      "https://api.deepseek.com/v1",
      "deepseek-v4-pro",
    );
    let usageFinish: string | null | undefined;
    let doneFinish: string | null | undefined;
    for await (const ev of provider.streamText({
      systemPrompt: "s",
      userPrompt: "u",
      providerModelId: "deepseek-v4-pro",
      maxOutputTokens: 100,
    })) {
      if (ev.type === "usage") usageFinish = ev.finishReason;
      if (ev.type === "done") doneFinish = ev.finishReason;
    }
    expect(usageFinish).toBe("length");
    expect(doneFinish).toBe("length");
  });
});

describe("streamBatchDesignPrompts adaptive behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves 3 completed assets and only retries remaining after truncation", async () => {
    stubBatchDeps();
    const items = ["a1", "a2", "a3", "a4", "a5"].map(makeItem);
    let call = 0;
    const callAssetCounts: number[] = [];

    const provider: TextGenerationProvider = {
      estimateInputTokens: (t) => t.length,
      estimateMaxOutputTokens: (c) => c,
      async *streamText(input) {
        call += 1;
        const ids = extractBatchAssetIds(String(input.userPrompt));
        callAssetCounts.push(ids.length);
        if (call === 1) {
          const lines = ids.slice(0, 3).map((id) =>
            JSON.stringify({
              type: "asset",
              asset_id: id,
              prompt: formalPromptFor(id),
              status: "completed",
            }),
          );
          yield {
            type: "delta",
            text: lines.join("\n") + "\n{\"type\":\"asset\",",
          };
          yield {
            type: "usage",
            inputTokens: 11,
            outputTokens: 22,
            finishReason: "length",
          };
          yield {
            type: "done",
            inputTokens: 11,
            outputTokens: 22,
            finishReason: "length",
          };
          return;
        }
        for (const id of ids) {
          yield {
            type: "delta",
            text:
              JSON.stringify({
                type: "asset",
                asset_id: id,
                prompt: formalPromptFor(id),
                status: "completed",
              }) + "\n",
          };
        }
        yield {
          type: "delta",
          text:
            JSON.stringify({
              type: "batch_end",
              completed_asset_ids: ids,
              failed_asset_ids: [],
              next_asset_id: "",
            }) + "\n",
        };
        yield {
          type: "usage",
          inputTokens: 5,
          outputTokens: 8,
          finishReason: "stop",
        };
        yield { type: "done", finishReason: "stop" };
      },
    };

    const result = await streamBatchDesignPrompts({
      projectId: "p1",
      userId: "u1",
      episodeId: "e1",
      items: items.map((item) => ({ item })),
      episodeText: "本集剧情",
      batchSize: 5,
      providerOverride: provider,
    });

    expect(result.completedAssetIds).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(callAssetCounts[0]).toBe(5);
    expect(callAssetCounts.slice(1).every((n) => n <= 2)).toBe(true);
    expect(result.outboundMessageRoles).toBe("system,user");
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.partialOutputChars).toBeGreaterThan(0);
    expect(result.attempts[0]?.requestedAssetIds).toHaveLength(5);
    expect(result.attempts[0]?.completedAssetIds).toHaveLength(3);
    expect(result.attempts.length).toBeGreaterThan(1);
  });

  it("shrinks and retries the incomplete assets after a model timeout", async () => {
    stubBatchDeps();
    const items = ["a1", "a2"].map(makeItem);
    let calls = 0;
    const provider: TextGenerationProvider = {
      estimateInputTokens: (t) => t.length,
      estimateMaxOutputTokens: (c) => c,
      async *streamText(input) {
        calls += 1;
        const ids = extractBatchAssetIds(String(input.userPrompt));
        if (calls === 1) {
          yield {
            type: "delta",
            text:
              JSON.stringify({
                type: "asset",
                asset_id: ids[0],
                prompt: formalPromptFor(ids[0]!),
                status: "completed",
              }) + "\n",
          };
          yield { type: "error", code: "MODEL_TIMEOUT", message: "timeout" };
          return;
        }
        for (const id of ids) {
          yield {
            type: "delta",
            text:
              JSON.stringify({
                type: "asset",
                asset_id: id,
                prompt: formalPromptFor(id),
                status: "completed",
              }) + "\n",
          };
        }
        yield {
          type: "delta",
          text:
            JSON.stringify({
              type: "batch_end",
              completed_asset_ids: ids,
              failed_asset_ids: [],
              next_asset_id: "",
            }) + "\n",
        };
      },
    };

    const result = await streamBatchDesignPrompts({
      projectId: "p1",
      userId: "u1",
      episodeId: "e1",
      items: items.map((item) => ({ item })),
      episodeText: "鏈泦鍓ф儏",
      batchSize: 2,
      providerOverride: provider,
    });

    expect(calls).toBe(2);
    expect(result.completedAssetIds).toEqual(["a1", "a2"]);
    expect(result.attempts[0]?.errorCode).toBe("MODEL_TIMEOUT");
    expect(result.attempts[1]?.requestedAssetIds).toEqual(["a2"]);
  });

  it("keeps parsed assets on MODEL_TIMEOUT-style cancel and does not send assistant history", async () => {
    stubBatchDeps();
    const items = ["a1", "a2"].map(makeItem);
    let sawAssistant = false;
    const provider: TextGenerationProvider = {
      estimateInputTokens: (t) => t.length,
      estimateMaxOutputTokens: (c) => c,
      async *streamText(input) {
        if (input.messages?.some((m) => m.role === "assistant")) {
          sawAssistant = true;
        }
        yield {
          type: "delta",
          text:
            JSON.stringify({
              type: "asset",
              asset_id: "a1",
              prompt: formalPromptFor("a1"),
              status: "completed",
            }) + "\n",
        };
        yield {
          type: "error",
          code: "MODEL_TIMEOUT",
          message: "timeout",
        };
      },
    };

    const result = await streamBatchDesignPrompts({
      projectId: "p1",
      userId: "u1",
      episodeId: "e1",
      items: items.map((item) => ({ item })),
      episodeText: "本集剧情",
      batchSize: 2,
      providerOverride: provider,
    });

    expect(sawAssistant).toBe(false);
    expect(result.completedAssetIds).toEqual(["a1"]);
    expect(result.failedAssetIds).toEqual(["a2"]);
    expect(result.messageRoles).toBe("system,user");
  });
});

describe("autoGenerateMissingFormalDesignPrompts batch client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues one request per batch of 5 and tracks progress by asset count", async () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem(`i${i}`));
    expect(items.filter(itemNeedsFormalDesignPrompt)).toHaveLength(10);

    let calls = 0;
    const progressSnapshots: Array<{ total: number; completed: number }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls += 1;
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          itemIds?: string[];
        };
        const ids = body.itemIds ?? [];
        return {
          ok: true,
          json: async () => ({
            ok: true,
            generationId: `tg_batch_${calls}`,
            requestedAssetIds: ids,
            completedAssetIds: ids,
            failedAssetIds: [],
            nextAssetId: "",
            batchSize: ids.length,
            items: ids.map((id) => ({
              itemId: id,
              status: "ready",
              text: formalPromptFor(id),
              generationId: `tg_batch_${calls}`,
              history: [],
            })),
          }),
        };
      }),
    );

    const result = await autoGenerateMissingFormalDesignPrompts({
      surface: "project_management",
      projectId: "p1",
      episodeId: "e1",
      items,
      batchSize: 5,
      requestConcurrency: 2,
      onProgress: (p) => {
        progressSnapshots.push({ total: p.total, completed: p.completed });
      },
    });

    expect(calls).toBe(2);
    expect(result.ok).toBe(10);
    expect(result.failed).toBe(0);
    expect(result.batchSize).toBe(5);
    expect(result.requestConcurrency).toBe(2);
    expect(progressSnapshots.some((p) => p.total === 10)).toBe(true);
    expect(progressSnapshots.at(-1)?.completed).toBe(10);
  });

  it("after refresh only generates missing assets", async () => {
    const items = [makeItem("ready1"), makeItem("miss1"), makeItem("miss2")];
    items[0] = {
      ...items[0]!,
      designPrompt: {
        status: "ready",
        text: LONG_PROMPT,
        generationId: "tg_old",
        sourceFingerprint: "fp",
        generatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        errorMessage: null,
        history: [],
      },
    };

    let requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          itemIds?: string[];
        };
        requested = body.itemIds ?? [];
        return {
          ok: true,
          json: async () => ({
            ok: true,
            generationId: "tg_new",
            requestedAssetIds: requested,
            completedAssetIds: requested,
            failedAssetIds: [],
            nextAssetId: "",
            batchSize: requested.length,
            items: requested.map((id) => ({
              itemId: id,
              status: "ready",
              text: formalPromptFor(id),
              generationId: "tg_new",
              history: [],
            })),
          }),
        };
      }),
    );

    const result = await autoGenerateMissingFormalDesignPrompts({
      surface: "project_management",
      projectId: "p1",
      episodeId: "e1",
      items,
      batchSize: 5,
    });
    expect(requested).toEqual(["miss1", "miss2"]);
    expect(result.started).toBe(2);
    expect(result.ok).toBe(2);
  });
});
