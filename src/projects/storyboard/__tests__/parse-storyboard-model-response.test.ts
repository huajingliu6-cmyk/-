import { describe, expect, it } from "vitest";
import {
  parseStoryboardModelResponse,
  parseSectionTextPrompts,
} from "@/projects/storyboard/services/parse-storyboard-model-response";
import {
  matchStoryboardPrompts,
  normalizeShotIdKey,
} from "@/projects/storyboard/services/match-storyboard-prompts";
import { buildProjectVisualStyleDirective } from "@/projects/storyboard/services/project-visual-style";
import { buildStoryboardPromptContext } from "@/projects/storyboard/services/storyboard-prompt-context";

describe("parseStoryboardModelResponse", () => {
  it("parses standard shots JSON object", () => {
    const raw = JSON.stringify({
      shots: [
        { shotId: "shot_001", videoPrompt: "提示词一" },
        { shotId: "shot_002", videoPrompt: "提示词二" },
      ],
    });
    const parsed = parseStoryboardModelResponse(raw);
    expect(parsed.parser).toBe("json");
    expect(parsed.prompts).toHaveLength(2);
    expect(parsed.prompts[0]?.sourceShotId).toBe("shot_001");
    expect(parsed.prompts[0]?.videoPrompt).toBe("提示词一");
  });

  it("parses bare JSON array", () => {
    const raw = JSON.stringify([
      { shotId: "shot_a", videoPrompt: "甲" },
      { shotId: "shot_b", videoPrompt: "乙" },
    ]);
    const parsed = parseStoryboardModelResponse(raw);
    expect(parsed.prompts.map((p) => p.videoPrompt)).toEqual(["甲", "乙"]);
  });

  it("parses Markdown JSON fence", () => {
    const raw = [
      "```json",
      JSON.stringify({
        shots: [{ shotId: "shot_001", videoPrompt: "围栏内提示词" }],
      }),
      "```",
    ].join("\n");
    const parsed = parseStoryboardModelResponse(raw);
    expect(parsed.parser).toBe("markdown_json");
    expect(parsed.prompts[0]?.videoPrompt).toBe("围栏内提示词");
  });

  it("extracts JSON surrounded by prose", () => {
    const raw = [
      "以下是生成结果：",
      JSON.stringify({
        shots: [{ shotId: "shot_001", videoPrompt: "带说明的提示词" }],
      }),
      "以上内容已完成。",
    ].join("\n");
    const parsed = parseStoryboardModelResponse(raw);
    expect(parsed.parser).toBe("embedded_json");
    expect(parsed.prompts[0]?.videoPrompt).toBe("带说明的提示词");
  });

  it("accepts shot_id / video_prompt aliases", () => {
    const parsed = parseStoryboardModelResponse(
      JSON.stringify({
        shots: [{ shot_id: "shot_001", video_prompt: "蛇形字段" }],
      }),
    );
    expect(parsed.prompts[0]?.sourceShotId).toBe("shot_001");
    expect(parsed.prompts[0]?.videoPrompt).toBe("蛇形字段");
  });

  it("accepts id / prompt aliases", () => {
    const parsed = parseStoryboardModelResponse(
      JSON.stringify([{ id: "shot_x", prompt: "通用字段" }]),
    );
    expect(parsed.prompts[0]?.sourceShotId).toBe("shot_x");
    expect(parsed.prompts[0]?.videoPrompt).toBe("通用字段");
  });

  it.each(["storyboard", "items", "data", "results"] as const)(
    "reads %s array envelope",
    (key) => {
      const parsed = parseStoryboardModelResponse(
        JSON.stringify({
          [key]: [{ shotId: "shot_001", videoPrompt: `from-${key}` }],
        }),
      );
      expect(parsed.prompts[0]?.videoPrompt).toBe(`from-${key}`);
    },
  );

  it("parses [分镜01] section text", () => {
    const raw = [
      "[分镜01｜总时长：12秒｜画幅：9:16]",
      "场景基调：雨夜。",
      "",
      "[分镜02｜总时长：10秒｜画幅：9:16]",
      "近景：对白。",
    ].join("\n");
    const parsed = parseStoryboardModelResponse(raw);
    expect(parsed.parser).toBe("section_text");
    expect(parsed.prompts).toHaveLength(2);
    expect(parsed.prompts[0]?.sourceShotNumber).toBe(1);
    expect(parsed.prompts[0]?.videoPrompt).toContain("[分镜01");
  });

  it("parses 【镜头02】 format", () => {
    const raw = ["【镜头01】", "第一镜", "", "【镜头02】", "第二镜"].join("\n");
    const prompts = parseSectionTextPrompts(raw);
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(prompts[1]?.sourceShotNumber).toBe(2);
  });

  it("parses 镜头 1： inline format", () => {
    const raw = ["镜头 1：雨夜长街", "镜头 2：推门而入"].join("\n");
    const parsed = parseStoryboardModelResponse(raw);
    expect(parsed.prompts).toHaveLength(2);
    expect(parsed.prompts[0]?.videoPrompt).toContain("雨夜长街");
  });

  it("parses Shot 1: english format", () => {
    const raw = ["Shot 1:", "wide shot of alley", "", "Shot 2:", "close-up"].join(
      "\n",
    );
    const parsed = parseStoryboardModelResponse(raw);
    expect(parsed.prompts.length).toBeGreaterThanOrEqual(2);
  });

  it("parses numbered list prompts", () => {
    const raw = [
      "1. 第一镜完整提示词内容足够长",
      "2. 第二镜完整提示词内容足够长",
    ].join("\n");
    const parsed = parseStoryboardModelResponse(raw);
    expect(parsed.prompts.length).toBe(2);
    expect(parsed.prompts[0]?.videoPrompt).toContain("第一镜");
  });

  it("accepts videoPrompt as string array", () => {
    const parsed = parseStoryboardModelResponse(
      JSON.stringify({
        shots: [
          {
            shotId: "shot_001",
            videoPrompt: ["第一段", "第二段"],
          },
        ],
      }),
    );
    expect(parsed.prompts[0]?.videoPrompt).toContain("第一段");
    expect(parsed.prompts[0]?.videoPrompt).toContain("第二段");
  });

  it("accepts Chinese prompt field aliases", () => {
    const parsed = parseStoryboardModelResponse(
      JSON.stringify({
        shots: [{ 镜头ID: "shot_001", 提示词: "中文字段提示词" }],
      }),
    );
    expect(parsed.prompts[0]?.sourceShotId).toBe("shot_001");
    expect(parsed.prompts[0]?.videoPrompt).toBe("中文字段提示词");
  });

  it("returns empty for blank / empty JSON / empty prompts", () => {
    expect(parseStoryboardModelResponse("").prompts).toHaveLength(0);
    expect(parseStoryboardModelResponse("{}").prompts).toHaveLength(0);
    expect(
      parseStoryboardModelResponse(
        JSON.stringify({ shots: [{ shotId: "a", videoPrompt: "   " }] }),
      ).prompts,
    ).toHaveLength(0);
  });

  it("tolerates illegal JSON without throwing", () => {
    expect(() =>
      parseStoryboardModelResponse("{not-json"),
    ).not.toThrow();
    expect(parseStoryboardModelResponse("{not-json").prompts).toHaveLength(0);
  });

  it("keeps first non-empty prompt for duplicate shotId", () => {
    const parsed = parseStoryboardModelResponse(
      JSON.stringify({
        shots: [
          { shotId: "shot_001", videoPrompt: "第一次" },
          { shotId: "shot_001", videoPrompt: "第二次" },
        ],
      }),
    );
    expect(parsed.prompts).toHaveLength(1);
    expect(parsed.prompts[0]?.videoPrompt).toBe("第一次");
    expect(parsed.diagnostics.duplicateIdCount).toBe(1);
  });
});

describe("matchStoryboardPrompts", () => {
  const targets = [
    { id: "shot_001", shotNumber: 1 },
    { id: "shot_002", shotNumber: 2 },
  ];

  it("matches exact shotId", () => {
    const result = matchStoryboardPrompts({
      targets,
      prompts: [
        { sourceShotId: "shot_001", videoPrompt: "A" },
        { sourceShotId: "shot_002", videoPrompt: "B" },
      ],
    });
    expect(result.matched.get("shot_001")).toBe("A");
    expect(result.unmatchedCount).toBe(0);
  });

  it("normalizes shot_001 vs shot-001 vs 001", () => {
    expect(normalizeShotIdKey("shot_001")).toBe("1");
    expect(normalizeShotIdKey("shot-001")).toBe("1");
    expect(normalizeShotIdKey("001")).toBe("1");
    const result = matchStoryboardPrompts({
      targets,
      prompts: [
        { sourceShotId: "shot-001", videoPrompt: "norm-a" },
        { sourceShotId: "02", videoPrompt: "norm-b" },
      ],
    });
    expect(result.matched.get("shot_001")).toBe("norm-a");
    expect(result.matched.get("shot_002")).toBe("norm-b");
  });

  it("matches by shot number 01", () => {
    const result = matchStoryboardPrompts({
      targets,
      prompts: [
        { sourceShotNumber: 1, videoPrompt: "num-1" },
        { sourceShotNumber: 2, videoPrompt: "num-2" },
      ],
    });
    expect(result.matched.get("shot_001")).toBe("num-1");
  });

  it("matches by stable order when counts equal and ids missing", () => {
    const result = matchStoryboardPrompts({
      targets,
      prompts: [{ videoPrompt: "按序一" }, { videoPrompt: "按序二" }],
    });
    expect(result.matched.get("shot_001")).toBe("按序一");
    expect(result.matched.get("shot_002")).toBe("按序二");
  });

  it("single-shot fallback without id", () => {
    const result = matchStoryboardPrompts({
      targets: [{ id: "only", shotNumber: 1 }],
      prompts: [{ videoPrompt: "单镜正文" }],
      singleShotFallback: true,
    });
    expect(result.matched.get("only")).toBe("单镜正文");
  });

  it("partial match keeps successes and lists unmatched", () => {
    const result = matchStoryboardPrompts({
      targets,
      prompts: [{ sourceShotId: "shot_001", videoPrompt: "仅第一镜" }],
    });
    expect(result.generatedCount).toBe(1);
    expect(result.unmatchedShotIds).toEqual(["shot_002"]);
  });

  it("does not assign one prompt to multiple shots", () => {
    const result = matchStoryboardPrompts({
      targets,
      prompts: [{ sourceShotId: "shot_001", videoPrompt: "唯一" }],
    });
    expect(result.matched.size).toBe(1);
    expect(result.matched.has("shot_002")).toBe(false);
  });
});

describe("project visual style for storyboard prompts", () => {
  it("builds canonical project style directives", () => {
    const cinematic = buildProjectVisualStyleDirective({
      visualStyle: "live_action_cinematic",
    });
    expect(cinematic).toContain("PROJECT_VISUAL_STYLE");
    expect(cinematic).toContain("live_action_cinematic");
    expect(cinematic).toContain("真人电影级");
    expect(cinematic).toContain("禁止动漫脸");

    const anime = buildProjectVisualStyleDirective({
      visualStyle: "three_d_animation",
    });
    expect(anime).toContain("three_d_animation");
    expect(anime).toContain("三维");
    expect(anime).toContain("禁止真人摄影");
  });

  it("injects style into prompt context from project visualStyle id", () => {
    const ctx = buildStoryboardPromptContext({
      scriptText: "剧本",
      visualStyle: "live_action_cinematic",
      highlights: "写实都市",
    });
    expect(ctx.visualStyleDirective).toContain("写实");
    expect(ctx.visualStyleDirective).toContain("写实都市");
    expect(ctx.visualStyleDirective).toContain("live_action_cinematic");
  });
});
