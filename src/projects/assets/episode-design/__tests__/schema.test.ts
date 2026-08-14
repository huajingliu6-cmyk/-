import { describe, expect, it } from "vitest";
import { parseEpisodeAssetDesignOutput } from "@/projects/assets/episode-design/schema";
import { buildScriptAssetChunks } from "@/projects/assets/episode-design/script-asset-chunks";
import {
  parseMapReduceState,
  runScriptAssetMapReduce,
  serializeMapReduceState,
} from "@/projects/assets/episode-design/script-asset-map-reduce";
import type { TextGenerationProvider } from "@/text-generation/provider/types";
import type { ProviderTextStreamEvent } from "@/text-generation/types";

describe("parseEpisodeAssetDesignOutput tolerant pipeline", () => {
  const valid = {
    version: 1 as const,
    assets: [
      {
        type: "character" as const,
        name: "林清",
        description: "女主角",
        design: { role: "主角", usageInEpisode: "开场" },
        evidence: "第一场出现",
      },
    ],
  };

  it("accepts pure JSON", () => {
    const r = parseEpisodeAssetDesignOutput(JSON.stringify(valid));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.assets[0]!.name).toBe("林清");
      expect(r.warnings).toBeDefined();
      expect(r.rejectedItems).toEqual([]);
    }
  });

  it("fails empty assets array (no valid assets)", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({ version: 1, assets: [] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EPISODE_ASSET_DESIGN_CONTENT_EMPTY");
  });

  it("accepts single json fence", () => {
    const raw = "```json\n" + JSON.stringify(valid) + "\n```";
    const r = parseEpisodeAssetDesignOutput(raw);
    expect(r.ok).toBe(true);
  });

  it("accepts leading prose when JSON object is embedded", () => {
    const r = parseEpisodeAssetDesignOutput("如下：\n" + JSON.stringify(valid));
    expect(r.ok).toBe(true);
  });

  it("merges duplicate same-type normalized names", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({
        version: 1,
        assets: [
          {
            type: "character",
            name: "林清",
            design: { usageInEpisode: "开场" },
          },
          {
            type: "character",
            name: "林清",
            design: { usageInEpisode: "高潮" },
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.assets).toHaveLength(1);
      expect(
        (r.value.assets[0]!.design as { usageInEpisode?: string }).usageInEpisode,
      ).toContain("开场");
      expect(
        (r.value.assets[0]!.design as { usageInEpisode?: string }).usageInEpisode,
      ).toContain("高潮");
      expect(r.warnings.some((w) => w.code === "ASSET_MERGED")).toBe(true);
    }
  });

  it("rejects dangerous model id fields before normalize", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({
        version: 1,
        modelId: "gpt-4",
        assets: [{ type: "character", name: "林清" }],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/不允许的字段|危险/);
  });

  it("rejects a single dangerous item but keeps siblings", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({
        version: 1,
        assets: [
          { type: "scene", name: "雨夜", existingAssetId: "x" },
          { type: "character", name: "林清", design: { role: "主角" } },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.assets).toHaveLength(1);
      expect(r.value.assets[0]!.name).toBe("林清");
      expect(r.rejectedItems.some((x) => x.code === "DANGEROUS_KEYS")).toBe(
        true,
      );
    }
  });

  it("promotes top-level usageInEpisode into design for a long batch", () => {
    const assets = Array.from({ length: 48 }, (_, i) => {
      const base: Record<string, unknown> = {
        type: i % 2 === 0 ? "character" : "scene",
        name: `资产${i + 1}`,
        design: {
          ...(i % 2 === 0
            ? { appearance: `外观${i + 1}` }
            : { location: `地点${i + 1}` }),
        },
      };
      // 27 consecutive items with top-level usageInEpisode (simulates production miss).
      if (i >= 10 && i < 37) {
        base.usageInEpisode = `本集用法${i + 1}`;
      } else {
        (base.design as Record<string, string>).usageInEpisode = `内层用法${i + 1}`;
      }
      return base;
    });
    const r = parseEpisodeAssetDesignOutput(JSON.stringify({ version: 1, assets }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.assets.length).toBe(48);
      const promoted = r.value.assets.filter((a) =>
        Boolean(
          (a.design as { usageInEpisode?: string } | undefined)?.usageInEpisode,
        ),
      );
      expect(promoted.length).toBe(48);
    }
  });

  it("accepts field aliases, chinese types, snake_case, and design shapes", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({
        version: 1,
        items: [
          {
            type: "人物",
            title: "江宸",
            design: "一位28岁男子，气质沉稳。",
          },
          {
            type: "场景",
            label: "办公室",
            design: ["封闭无窗", "孤灯昏黄"],
          },
          {
            type: "道具",
            name: "铜匣",
            design: {
              prop_type: "关键道具",
              function: "收藏信物",
              usage_in_episode: "沉江",
            },
          },
          {
            type: "音效",
            name: "汽笛",
            design: { audio_kind: "音效", description: "远处汽笛" },
          },
          {
            type: "character",
            name: "空设计",
            design: null,
            description: "仅描述",
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.assets).toHaveLength(5);
      expect(r.value.assets.map((a) => a.type).sort()).toEqual(
        ["audio", "character", "character", "prop", "scene"].sort(),
      );
      expect(
        (r.value.assets.find((a) => a.name === "铜匣")!.design as { propType?: string })
          .propType,
      ).toBe("关键道具");
      expect(
        (r.value.assets.find((a) => a.name === "汽笛")!.design as { audioKind?: string })
          .audioKind,
      ).toBe("sfx");
    }
  });

  it("keeps valid assets when one item fails", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({
        version: 1,
        assets: [
          { type: "character", name: "林清", design: { role: "主角" } },
          { type: "unknown_type", name: "坏项" },
          { type: "prop", name: "铜匣", design: { usage: "沉江" } },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.assets).toHaveLength(2);
      expect(r.rejectedItems.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("repairs trailing commas via jsonrepair", () => {
    const raw = `{"version":1,"assets":[{"type":"character","name":"林清","design":{"role":"主角",},},]}`;
    const r = parseEpisodeAssetDesignOutput(raw);
    expect(r.ok).toBe(true);
  });

  it("rejects empty name as content empty when all fail", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({
        version: 1,
        assets: [{ type: "prop", name: "  " }],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EPISODE_ASSET_DESIGN_CONTENT_EMPTY");
  });

  it("accepts model design objects with concept and prompt", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({
        version: 1,
        assets: [
          {
            type: "character",
            name: "Serena",
            design: {
              concept: "人物视觉设计提示词",
              prompt: "26岁女总裁，黑发盘起，身穿深灰色西装。",
            },
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(
        (r.value.assets[0]!.design as { appearance?: string }).appearance,
      ).toContain("女总裁");
    }
  });
});

describe("script asset chunking + map-reduce", () => {
  it("chunks by episodes under budget", () => {
    const episodes = Array.from({ length: 6 }, (_, i) => ({
      id: `e${i + 1}`,
      episodeNumber: i + 1,
      title: `第${i + 1}集`,
      content: "台词。".repeat(4000),
    }));
    const chunks = buildScriptAssetChunks({
      sourceText: "ignored",
      episodes,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.visibleChars <= 30_000)).toBe(true);
  });

  it("merges successful chunks and allows retrying failed ones", async () => {
    let calls = 0;
    const provider: TextGenerationProvider = {
      estimateInputTokens: (t) => Math.ceil(t.length / 4),
      estimateMaxOutputTokens: (n) => n,
      async *streamText(): AsyncGenerator<ProviderTextStreamEvent, void, unknown> {
        calls += 1;
        if (calls === 2) {
          yield { type: "error", code: "NETWORK_ERROR", message: "boom" };
          return;
        }
        yield {
          type: "delta",
          text: JSON.stringify({
            version: 1,
            assets: [
              {
                type: "character",
                name: calls === 1 ? "甲" : "乙",
                design: { role: "配角" },
              },
            ],
          }),
        };
        yield { type: "done" };
      },
    };

    const chunks = [
      {
        chunkId: "c1",
        label: "块1",
        brief: "b1",
        visibleChars: 10,
      },
      {
        chunkId: "c2",
        label: "块2",
        brief: "b2",
        visibleChars: 10,
      },
      {
        chunkId: "c3",
        label: "块3",
        brief: "b3",
        visibleChars: 10,
      },
    ];

    const first = await runScriptAssetMapReduce({
      chunks,
      provider,
      systemPrompt: "sys",
      providerModelId: "mock",
      maxOutputTokens: 1000,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.dto.assets.some((a) => a.name === "甲")).toBe(true);
    const failed = first.state.chunks.filter((c) => c.status === "failed");
    expect(failed.length).toBeGreaterThanOrEqual(1);

    const serialized = serializeMapReduceState(first.state);
    const previous = parseMapReduceState(serialized);
    const retry = await runScriptAssetMapReduce({
      chunks,
      provider,
      systemPrompt: "sys",
      providerModelId: "mock",
      maxOutputTokens: 1000,
      previousState: previous,
      onlyChunkIds: failed.map((f) => f.chunkId),
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      // Successful chunk content reused — no need to regenerate 甲.
      expect(retry.dto.assets.some((a) => a.name === "甲")).toBe(true);
    }
  });
});
