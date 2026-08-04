import { describe, expect, it } from "vitest";
import { parseEpisodeAssetDesignOutput } from "@/projects/assets/episode-design/schema";

describe("parseEpisodeAssetDesignOutput", () => {
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
    if (r.ok) expect(r.value.assets[0]!.name).toBe("林清");
  });

  it("accepts empty assets array", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({ version: 1, assets: [] }),
    );
    expect(r.ok).toBe(true);
  });

  it("accepts single json fence", () => {
    const raw = "```json\n" + JSON.stringify(valid) + "\n```";
    const r = parseEpisodeAssetDesignOutput(raw);
    expect(r.ok).toBe(true);
  });

  it("rejects leading prose", () => {
    const r = parseEpisodeAssetDesignOutput("如下：\n" + JSON.stringify(valid));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EPISODE_ASSET_DESIGN_OUTPUT_INVALID");
  });

  it("rejects duplicate same-type normalized names", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({
        version: 1,
        assets: [
          { type: "character", name: "林清" },
          { type: "character", name: "林清" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects model id fields", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({
        version: 1,
        modelId: "gpt-4",
        assets: [],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects existingAssetId in asset item", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({
        version: 1,
        assets: [{ type: "scene", name: "雨夜", existingAssetId: "x" }],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("accepts design as prose string by coercing to object", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({
        version: 1,
        assets: [
          {
            type: "character",
            name: "江宸",
            description: "主角",
            design: "一位28岁男子，气质沉稳，穿深色卫衣。",
          },
          {
            type: "scene",
            name: "办公室",
            design: "封闭无窗的旧式办公室，孤灯昏黄。",
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.assets).toHaveLength(2);
      expect(
        (r.value.assets[0]!.design as { appearance?: string }).appearance,
      ).toContain("28岁");
      expect(
        (r.value.assets[1]!.design as { location?: string }).location,
      ).toContain("办公室");
    }
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
          {
            type: "prop",
            name: "狐尾戒指",
            design: {
              concept: "道具视觉设计提示词",
              prompt: "银色指环托着一颗发光的半透明白色晶石。",
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
      expect(
        (r.value.assets[1]!.design as { usage?: string }).usage,
      ).toContain("银色指环");
    }
  });

  it("rejects empty name", () => {
    const r = parseEpisodeAssetDesignOutput(
      JSON.stringify({
        version: 1,
        assets: [{ type: "prop", name: "  " }],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EPISODE_ASSET_DESIGN_CONTENT_EMPTY");
  });
});
