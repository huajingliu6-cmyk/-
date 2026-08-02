import { describe, expect, it } from "vitest";
import {
  assertSafeScriptEpisodesGenerationRequest,
  buildScriptEpisodesGenerationRequest,
  buildScriptEpisodesProviderBrief,
} from "@/projects/story/script-episodes-generation-prompt";

describe("script episodes generation request", () => {
  it("builds request with saved outline and single episode number", () => {
    const body = buildScriptEpisodesGenerationRequest({
      brief: "补充设定",
      outlineText: "【故事核心】测试大纲",
      episodeNumber: 3,
      modelKey: "balanced-default",
      targetChars: 500,
      idempotencyKey: "episodes_x",
    });
    expect(body.outputKind).toBe("script_episodes");
    expect(body.episodeNumber).toBe(3);
    expect(body.outlineText).toContain("测试大纲");
    expect(body.targetChars).toBe(500);
    expect(body.idempotencyKey).toBe("episodes_x");
  });

  it("provider brief includes outline and episode target, not secrets", () => {
    const body = buildScriptEpisodesGenerationRequest({
      brief: "补充",
      outlineText: "大纲正文",
      episodeNumber: 1,
      modelKey: "balanced-default",
      targetChars: 400,
      idempotencyKey: "k",
    });
    const brief = buildScriptEpisodesProviderBrief(body);
    expect(brief).toContain("【目标集号】第1集");
    expect(brief).toContain("大纲正文");
    expect(brief).not.toMatch(/cookie|password|api[_-]?key|Authorization/i);
    expect(brief).not.toMatch(/C:\\\\|file:\/\//i);
  });

  it("rejects empty outline", () => {
    expect(() =>
      assertSafeScriptEpisodesGenerationRequest(
        buildScriptEpisodesGenerationRequest({
          brief: "x",
          outlineText: "  ",
          episodeNumber: 1,
          modelKey: "balanced-default",
          targetChars: 300,
          idempotencyKey: "k",
        }),
      ),
    ).toThrow(/大纲/);
  });

  it("does not silently attach full prior script", () => {
    const body = buildScriptEpisodesGenerationRequest({
      brief: "",
      outlineText: "仅大纲",
      episodeNumber: 2,
      modelKey: "balanced-default",
      targetChars: 300,
      idempotencyKey: "k",
    });
    const brief = buildScriptEpisodesProviderBrief(body);
    expect(brief).not.toContain("正式剧本全文");
    expect(brief).toContain("仅大纲");
  });
});
